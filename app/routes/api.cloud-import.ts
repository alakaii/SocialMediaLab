import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import path from "node:path";
import sharp from "sharp";
import shopify from "../shopify.server.js";
import {
  ShopifyFileUploadError,
  uploadBufferToShopifyFiles,
  type AdminGraphqlClient,
} from "../services/files.server.js";
import {
  CLOUD_IMPORT_MAX_FILES,
  type CloudImportRequestFile,
  type CloudImportResult,
} from "../utils/cloudProviders.js";

/**
 * Imports media the merchant picked in a cloud provider's file picker.
 *
 * The picker hands the browser a TEMPORARY direct link, so the client posts it
 * here immediately and this route copies the bytes into Shopify Files, returning
 * the same permanent CDN URL shape /api/upload does. Nothing durable ever points
 * at the provider.
 *
 * This route fetches URLs supplied by the browser, so it is a potential SSRF
 * hole. Two things keep it closed: the host allow-list below, and re-checking
 * that allow-list on every redirect hop rather than letting fetch follow
 * redirects on its own.
 */

const MAX_IMPORT_MB = 500;
const MAX_IMPORT_BYTES = MAX_IMPORT_MB * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** Hosts the Dropbox Chooser hands out direct links on. Nothing else is fetched. */
function isAllowedSource(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return (
    host === "dl.dropboxusercontent.com" ||
    host === "dropbox.com" ||
    host.endsWith(".dropbox.com")
  );
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

/** A failure with a message that is safe (and useful) to show the merchant. */
class CloudImportError extends Error {}

function describeFailure(error: unknown): string {
  if (error instanceof CloudImportError) return error.message;
  if (error instanceof ShopifyFileUploadError) return error.message;
  return "This file could not be imported. Please try again.";
}

/**
 * Reads the request body into the list of files to import, or returns a message
 * explaining why it is unusable. Everything here arrives from the browser, so
 * nothing is trusted beyond "is it the right shape".
 */
function parseRequestedFiles(
  payload: unknown,
): { files: CloudImportRequestFile[] } | { error: string } {
  if (!Array.isArray(payload)) {
    return { error: "That import request could not be read. Please try again." };
  }
  if (payload.length === 0) {
    return { error: "No files were selected." };
  }
  if (payload.length > CLOUD_IMPORT_MAX_FILES) {
    return {
      error: `You can import up to ${CLOUD_IMPORT_MAX_FILES} files at a time. Please select fewer files.`,
    };
  }

  const files: CloudImportRequestFile[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      return { error: "That import request could not be read. Please try again." };
    }
    const { url, name } = entry as { url?: unknown; name?: unknown };
    if (typeof url !== "string" || url.length === 0) {
      return { error: "One of the selected files is missing its link. Please try again." };
    }
    files.push({ url, name: typeof name === "string" ? name : "" });
  }
  return { files };
}

/**
 * Fetches the link, following redirects by hand so every hop is checked against
 * the allow-list. A provider link that redirects off to an internal address is
 * rejected instead of quietly fetched.
 */
async function fetchFromAllowedSource(
  rawUrl: string,
): Promise<{ response: Response; url: URL }> {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let target: URL;
    try {
      target = new URL(current);
    } catch {
      throw new CloudImportError("That file's link is not a valid web address.");
    }

    if (!isAllowedSource(target)) {
      throw new CloudImportError("Only Dropbox links can be imported right now.");
    }

    let response: Response;
    try {
      response = await fetch(target, { redirect: "manual" });
    } catch {
      throw new CloudImportError(
        "That file could not be downloaded from Dropbox. Please try again.",
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new CloudImportError("That file's link could not be followed.");
      }
      current = new URL(location, target).toString();
      continue;
    }

    if (!response.ok) {
      throw new CloudImportError(
        "That file is no longer available from Dropbox. Please pick it again.",
      );
    }

    return { response, url: target };
  }

  throw new CloudImportError("That file's link redirected too many times.");
}

/**
 * Buffers the response body, stopping the moment it goes over the cap so an
 * oversized (or unbounded) download cannot exhaust the app's memory. The
 * Content-Length header is only a hint, so the running total is what enforces it.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new CloudImportError(`Files must be ${MAX_IMPORT_MB}MB or smaller.`);
  }

  const body = response.body;
  if (!body) {
    throw new CloudImportError("That file came back empty.");
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new CloudImportError(`Files must be ${MAX_IMPORT_MB}MB or smaller.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * The name the file gets in Settings > Files. Built from the picker's name where
 * possible, stripped of anything that could confuse a path or a header, and
 * given the link's extension when the picker did not supply one.
 */
function resolveFilename(rawName: string, sourceUrl: URL): string {
  // Allow-list rather than strip-list: this string ends up in a multipart
  // filename header on the way to Shopify file storage, so control characters,
  // quotes and path separators must not survive. Anything else collapses to an
  // underscore, which keeps the extension (and so the type check) intact.
  const clean = (value: string) =>
    path.basename(value).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");

  let fromUrl = "";
  try {
    fromUrl = clean(decodeURIComponent(sourceUrl.pathname));
  } catch {
    fromUrl = clean(sourceUrl.pathname);
  }

  const candidate = clean(rawName) || fromUrl || "cloud-import";
  const named = path.extname(candidate)
    ? candidate
    : `${candidate}${path.extname(fromUrl)}`;
  return named.slice(0, 120);
}

/**
 * Only images and videos may become post media. Dropbox commonly serves files as
 * application/octet-stream, so a generic or missing content type falls back to
 * the extension; anything that still does not resolve to an image or video is
 * rejected.
 */
function resolveMimeType(headerValue: string | null, filename: string): string | null {
  const fromHeader = (headerValue ?? "").split(";")[0].trim().toLowerCase();
  if (fromHeader.startsWith("image/") || fromHeader.startsWith("video/")) {
    return fromHeader;
  }
  return EXTENSION_MIME_TYPES[path.extname(filename).toLowerCase()] ?? null;
}

async function importOneFile(
  admin: AdminGraphqlClient,
  file: CloudImportRequestFile,
): Promise<CloudImportResult> {
  const { response, url } = await fetchFromAllowedSource(file.url);
  const filename = resolveFilename(file.name, url);

  const mimeType = resolveMimeType(response.headers.get("content-type"), filename);
  if (!mimeType) {
    await response.body?.cancel().catch(() => {});
    return {
      ok: false,
      name: filename,
      error: "Only image and video files can be added to a post.",
    };
  }

  const data = await readCapped(response, MAX_IMPORT_BYTES);
  if (data.byteLength === 0) {
    return { ok: false, name: filename, error: "That file is empty." };
  }

  const uploaded = await uploadBufferToShopifyFiles(admin, { data, filename, mimeType });

  let { width, height } = uploaded;
  // Shopify reports dimensions for images it has processed; measure locally only
  // if it did not, while the bytes are still in hand.
  if (mimeType.startsWith("image/") && (width === undefined || height === undefined)) {
    try {
      const meta = await sharp(data).metadata();
      width = width ?? meta.width;
      height = height ?? meta.height;
    } catch {
      // Non-fatal: the asset is usable without dimensions.
    }
  }

  return {
    ok: true,
    name: filename,
    url: uploaded.url,
    mimeType,
    sizeBytes: data.byteLength,
    width,
    height,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Authenticate before anything is fetched: this endpoint writes to the
  // merchant's Shopify Files and makes outbound requests, so it must never run
  // anonymously.
  const { admin } = await shopify.authenticate.admin(request);

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(
      { error: "That import request could not be read. Please try again." },
      { status: 400 },
    );
  }

  const parsed = parseRequestedFiles(payload);
  if ("error" in parsed) {
    return json({ error: parsed.error }, { status: 400 });
  }

  // Sequential on purpose: each file is buffered in memory before it goes up to
  // Shopify, and ten concurrent 500MB downloads would take the container with
  // them.
  const results: CloudImportResult[] = [];
  for (const file of parsed.files) {
    try {
      results.push(await importOneFile(admin, file));
    } catch (error) {
      // A Response thrown by the Shopify client (a 401 needing re-auth, say) is
      // Remix's to handle, not a per-file failure.
      if (error instanceof Response) throw error;
      if (!(error instanceof CloudImportError)) {
        console.error("[api.cloud-import] import failed", error);
      }
      results.push({
        ok: false,
        name: resolveFilenameForError(file),
        error: describeFailure(error),
      });
    }
  }

  return json({ results });
};

/** Best-effort label for a file that failed before its name could be resolved. */
function resolveFilenameForError(file: CloudImportRequestFile): string {
  const name = file.name.trim();
  return name ? name.slice(0, 120) : "Selected file";
}
