/**
 * Uploads post media to Shopify Files through the Admin GraphQL API.
 *
 * Media used to be written to public/uploads on the app container's disk and
 * referenced by a relative "/uploads/..." URL. That cannot work in production:
 * Railway wipes the container disk on every deploy, and the publishing worker
 * runs in a separate container, so at publish time it can neither read the file
 * nor resolve a relative URL. Shopify Files hands back a permanent, absolute CDN
 * URL that the app, the worker, and the social platform APIs can all fetch.
 *
 * Requires the write_files access scope (declared in shopify.app.toml).
 */

import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";

// Minimal shape of the admin GraphQL client returned by authenticate.admin.
// Declared locally so this module stays independent of the other Admin API
// services.
export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export interface ShopifyFileUpload {
  /** Absolute path of the temp file holding the uploaded bytes. */
  filepath: string;
  /** Name the merchant will see in Settings > Files. */
  filename: string;
  mimeType: string;
}

export interface ShopifyFileBufferUpload {
  /**
   * The file's bytes, already in memory. Backed by a plain ArrayBuffer (rather
   * than the SharedArrayBuffer a bare Uint8Array also allows) so the bytes can
   * go straight into a Blob without being copied a second time.
   */
  data: Uint8Array<ArrayBuffer>;
  /** Name the merchant will see in Settings > Files. */
  filename: string;
  mimeType: string;
}

export interface ShopifyFileUploadResult {
  /** Permanent, absolute Shopify CDN URL. */
  url: string;
  /** Only populated for images, and only when Shopify reports the dimensions. */
  width?: number;
  height?: number;
}

/**
 * An upload failure with a message that is safe (and useful) to show a merchant.
 * `status` is the HTTP status the calling route should respond with.
 */
export class ShopifyFileUploadError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ShopifyFileUploadError";
    this.status = status;
  }
}

// Shopify processes uploaded files asynchronously, so the CDN URL only exists
// once fileStatus flips to READY. Images are usually ready inside a couple of
// seconds; the cap keeps a stuck file from holding the request open.
const POLL_INTERVAL_MS = 700;
const POLL_TIMEOUT_MS = 20_000;

const STAGED_UPLOADS_CREATE_MUTATION = `#graphql
  mutation SocialLabStagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE_MUTATION = `#graphql
  mutation SocialLabFileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        ... on MediaImage { image { url width height } }
        ... on GenericFile { url }
      }
      userErrors { field message code }
    }
  }
`;

const FILE_STATUS_QUERY = `#graphql
  query SocialLabFileStatus($id: ID!) {
    node(id: $id) {
      __typename
      ... on MediaImage {
        fileStatus
        fileErrors { code details message }
        image { url width height }
      }
      ... on GenericFile {
        fileStatus
        fileErrors { code details message }
        url
      }
    }
  }
`;

interface UserError {
  field?: string[] | null;
  message?: string | null;
}

interface StagedTarget {
  url?: string | null;
  resourceUrl?: string | null;
  parameters?: { name?: string | null; value?: string | null }[] | null;
}

interface FileErrorNode {
  code?: string | null;
  details?: string | null;
  message?: string | null;
}

/**
 * The union of the fields our fragments select. `image` is only ever set on a
 * MediaImage and the bare `url` only on a GenericFile, so reading both and
 * taking the first non-null is enough to cover either branch.
 */
interface FileNode {
  __typename?: string | null;
  id?: string | null;
  fileStatus?: string | null;
  fileErrors?: FileErrorNode[] | null;
  image?: { url?: string | null; width?: number | null; height?: number | null } | null;
  url?: string | null;
}

function describeGraphqlErrors(errors: unknown): string {
  if (typeof errors === "string") return errors;
  if (!Array.isArray(errors)) return "";
  return errors
    .map((error) =>
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : null,
    )
    .filter((message): message is string => Boolean(message))
    .join("; ");
}

function describeUserErrors(userErrors: UserError[] | null | undefined): string {
  return (userErrors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message))
    .join("; ");
}

function describeFileErrors(fileErrors: FileErrorNode[] | null | undefined): string {
  return (fileErrors ?? [])
    .map((error) => error.details || error.message || error.code)
    .filter((message): message is string => Boolean(message))
    .join("; ");
}

/**
 * Runs an Admin API operation, turning transport failures and GraphQL errors
 * into a ShopifyFileUploadError. Responses thrown by the Shopify client (a 401
 * that needs re-authentication, for example) are re-thrown untouched so Remix
 * can handle them.
 */
async function runAdmin<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables: Record<string, unknown>,
  context: string,
): Promise<T> {
  let body: { data?: T; errors?: unknown };

  try {
    const response = await admin.graphql(query, { variables });
    body = (await response.json()) as { data?: T; errors?: unknown };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new ShopifyFileUploadError(`Could not reach Shopify while ${context}. Please try again.`);
  }

  if (!body?.data || body.errors) {
    const detail = describeGraphqlErrors(body?.errors);
    throw new ShopifyFileUploadError(
      `Shopify rejected the request while ${context}.${detail ? ` ${detail}` : ""}`,
    );
  }

  return body.data;
}

/**
 * A file-backed Blob is streamed straight from disk when fetch sends it, so a
 * 500MB video never has to sit in memory. openAsBlob has been available since
 * Node 20 and this app pins Node >= 22, but fall back to a buffered read on any
 * runtime that lacks it.
 */
async function readAsBlob(filepath: string, mimeType: string): Promise<Blob> {
  if (typeof openAsBlob === "function") {
    return openAsBlob(filepath, { type: mimeType });
  }
  const bytes = await readFile(filepath);
  return new Blob([bytes], { type: mimeType });
}

/** Step 1: ask Shopify where to put the bytes. */
async function createStagedTarget(
  admin: AdminGraphqlClient,
  input: { resource: "IMAGE" | "FILE"; filename: string; mimeType: string; fileSize: string },
): Promise<{ url: string; resourceUrl: string; parameters: { name: string; value: string }[] }> {
  const data = await runAdmin<{
    stagedUploadsCreate?: { stagedTargets?: StagedTarget[] | null; userErrors?: UserError[] | null } | null;
  }>(
    admin,
    STAGED_UPLOADS_CREATE_MUTATION,
    {
      input: [
        {
          resource: input.resource,
          filename: input.filename,
          mimeType: input.mimeType,
          httpMethod: "POST",
          fileSize: input.fileSize,
        },
      ],
    },
    "preparing the upload",
  );

  const payload = data.stagedUploadsCreate;
  const userErrors = describeUserErrors(payload?.userErrors);
  if (userErrors) {
    throw new ShopifyFileUploadError(`Shopify would not accept this file: ${userErrors}`, 400);
  }

  const target = payload?.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) {
    throw new ShopifyFileUploadError("Shopify did not return an upload target. Please try again.");
  }

  const parameters = (target.parameters ?? [])
    .filter((parameter): parameter is { name: string; value: string } =>
      typeof parameter?.name === "string" && typeof parameter?.value === "string",
    );

  return { url: target.url, resourceUrl: target.resourceUrl, parameters };
}

/** Step 2: POST the bytes to the staged target. */
async function uploadBytes(
  target: { url: string; parameters: { name: string; value: string }[] },
  blob: Blob,
  filename: string,
): Promise<void> {
  const form = new FormData();
  // Order matters: the signed policy fields have to precede the file part, and
  // the file part has to be last.
  for (const parameter of target.parameters) {
    form.append(parameter.name, parameter.value);
  }
  form.append("file", blob, filename);

  let response: Response;
  try {
    response = await fetch(target.url, { method: "POST", body: form });
  } catch {
    throw new ShopifyFileUploadError(
      `Could not send "${filename}" to Shopify's file storage. Please check your connection and try again.`,
    );
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
    throw new ShopifyFileUploadError(
      `Shopify's file storage rejected "${filename}" (HTTP ${response.status}).${detail ? ` ${detail}` : ""}`,
    );
  }
}

/** Step 3: register the staged upload as a file on the shop. */
async function createFile(
  admin: AdminGraphqlClient,
  input: { originalSource: string; contentType: "IMAGE" | "FILE"; filename: string },
): Promise<FileNode> {
  const data = await runAdmin<{
    fileCreate?: { files?: FileNode[] | null; userErrors?: UserError[] | null } | null;
  }>(
    admin,
    FILE_CREATE_MUTATION,
    {
      files: [
        {
          originalSource: input.originalSource,
          contentType: input.contentType,
          alt: input.filename,
          filename: input.filename,
          // Merchants reuse filenames constantly ("image.jpg"); keep both copies
          // instead of erroring out or overwriting the earlier post's media.
          duplicateResolutionMode: "APPEND_UUID",
        },
      ],
    },
    "saving the file to Shopify",
  );

  const payload = data.fileCreate;
  const userErrors = describeUserErrors(payload?.userErrors);
  if (userErrors) {
    throw new ShopifyFileUploadError(`Shopify would not accept this file: ${userErrors}`, 400);
  }

  const file = payload?.files?.[0];
  if (!file?.id) {
    throw new ShopifyFileUploadError("Shopify did not return the saved file. Please try again.");
  }

  return file;
}

/**
 * A URL is only trustworthy once processing has finished; Shopify can echo one
 * back while the file is still UPLOADED, and fetching it that early can 404.
 */
function extractResult(node: FileNode): ShopifyFileUploadResult | null {
  if (node.fileStatus !== "READY") return null;
  const url = node.image?.url ?? node.url ?? null;
  if (!url) return null;
  return {
    url,
    width: node.image?.width ?? undefined,
    height: node.image?.height ?? undefined,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Step 4: fileCreate returns before processing finishes, so poll the file until
 * Shopify publishes its CDN URL.
 */
async function waitForCdnUrl(
  admin: AdminGraphqlClient,
  id: string,
  filename: string,
): Promise<ShopifyFileUploadResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  for (;;) {
    await sleep(POLL_INTERVAL_MS);

    const data = await runAdmin<{ node?: FileNode | null }>(
      admin,
      FILE_STATUS_QUERY,
      { id },
      "checking the upload status",
    );
    const node = data.node;

    if (node) {
      const typename = node.__typename;
      if (typename && typename !== "MediaImage" && typename !== "GenericFile") {
        throw new ShopifyFileUploadError(`Shopify stored "${filename}" in a format this app cannot use.`);
      }

      if (node.fileStatus === "FAILED") {
        const detail = describeFileErrors(node.fileErrors);
        throw new ShopifyFileUploadError(
          `Shopify could not process "${filename}".${detail ? ` ${detail}` : ""}`,
          400,
        );
      }

      const result = extractResult(node);
      if (result) return result;
    }

    if (Date.now() >= deadline) {
      throw new ShopifyFileUploadError(
        `Timed out waiting for Shopify to finish processing "${filename}". It may still show up under Settings > Files - please try adding it again in a moment.`,
      );
    }
  }
}

/**
 * The whole staged-upload dance, from a Blob the caller already has. Images go
 * up as IMAGE so Shopify reports their dimensions; everything else (video
 * included) goes up as a generic FILE, which keeps a directly downloadable URL
 * that the social platform APIs can ingest, rather than the transcoded streaming
 * sources a Shopify-hosted VIDEO would produce.
 */
async function uploadBlobToShopifyFiles(
  admin: AdminGraphqlClient,
  blob: Blob,
  filename: string,
  mimeType: string,
): Promise<ShopifyFileUploadResult> {
  const isImage = mimeType.startsWith("image/");
  const contentType = isImage ? "IMAGE" : "FILE";

  if (blob.size === 0) {
    throw new ShopifyFileUploadError(`"${filename}" is empty.`, 400);
  }

  const target = await createStagedTarget(admin, {
    resource: contentType,
    filename,
    mimeType,
    // UnsignedInt64 is serialized as a string.
    fileSize: String(blob.size),
  });

  await uploadBytes(target, blob, filename);

  const file = await createFile(admin, {
    originalSource: target.resourceUrl,
    contentType,
    filename,
  });

  // Small images are occasionally ready by the time fileCreate returns.
  const immediate = extractResult(file);
  if (immediate) return immediate;

  return waitForCdnUrl(admin, file.id as string, filename);
}

/**
 * Uploads a local temp file to Shopify Files and returns its permanent CDN URL.
 *
 * The caller owns the temp file and is responsible for deleting it.
 */
export async function uploadToShopifyFiles(
  admin: AdminGraphqlClient,
  upload: ShopifyFileUpload,
): Promise<ShopifyFileUploadResult> {
  const blob = await readAsBlob(upload.filepath, upload.mimeType);
  return uploadBlobToShopifyFiles(admin, blob, upload.filename, upload.mimeType);
}

/**
 * Same upload, for bytes that never touched disk. Cloud imports stream the file
 * out of the provider straight into memory, so there is no temp file to hand to
 * uploadToShopifyFiles. Callers are responsible for capping the size before they
 * buffer (see api.cloud-import).
 */
export async function uploadBufferToShopifyFiles(
  admin: AdminGraphqlClient,
  upload: ShopifyFileBufferUpload,
): Promise<ShopifyFileUploadResult> {
  const blob = new Blob([upload.data], { type: upload.mimeType });
  return uploadBlobToShopifyFiles(admin, blob, upload.filename, upload.mimeType);
}
