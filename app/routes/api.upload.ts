import type { ActionFunctionArgs } from "@remix-run/node";
import {
  json,
  MaxPartSizeExceededError,
  NodeOnDiskFile,
  unstable_createFileUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import shopify from "../shopify.server.js";
import { ShopifyFileUploadError, uploadToShopifyFiles } from "../services/files.server.js";

/**
 * Receives a media file from the post wizard and stores it in Shopify Files,
 * returning the permanent CDN URL that MediaAsset.url keeps.
 *
 * The bytes only touch local disk long enough to stream them on to Shopify: the
 * app container's disk is wiped on every Railway deploy and the publishing
 * worker runs elsewhere, so nothing durable can live there. The temp file is
 * always removed before the response is sent.
 */

const MAX_UPLOAD_MB = 500;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const TEMP_DIR = path.join(os.tmpdir(), "social-media-lab-uploads");

export const action = async ({ request }: ActionFunctionArgs) => {
  // Authenticate before a single byte is read: this endpoint writes to the
  // merchant's Shopify Files, so it must never run anonymously, and an
  // unauthenticated caller should not be able to spool 500MB to disk first.
  const { admin } = await shopify.authenticate.admin(request);

  // Absolute temp path -> the filename the merchant's browser sent. The upload
  // handler names files on disk, so this is the only place the original name
  // survives, and it doubles as the list of temp files to clean up (including
  // any written before a mid-parse failure).
  const tempFiles = new Map<string, string>();

  const uploadHandler = unstable_createFileUploadHandler({
    directory: TEMP_DIR,
    maxPartSize: MAX_UPLOAD_BYTES,
    // A UUID on disk keeps concurrent uploads of the same filename from
    // colliding, so Remix's conflict-avoidance renaming is not needed.
    avoidFileConflicts: false,
    file: ({ filename }) => {
      const diskName = `${randomUUID()}${path.extname(filename)}`;
      tempFiles.set(path.resolve(TEMP_DIR, diskName), path.basename(filename));
      return diskName;
    },
  });

  const cleanUp = async () => {
    await Promise.all([...tempFiles.keys()].map((filepath) => unlink(filepath).catch(() => {})));
    tempFiles.clear();
  };

  let formData: FormData;
  try {
    formData = await unstable_parseMultipartFormData(request, uploadHandler);
  } catch (error) {
    await cleanUp();
    if (error instanceof MaxPartSizeExceededError) {
      return json({ error: `Files must be ${MAX_UPLOAD_MB}MB or smaller.` }, { status: 413 });
    }
    return json({ error: "That upload could not be read. Please try again." }, { status: 400 });
  }

  try {
    const file = formData.get("file");
    if (!(file instanceof NodeOnDiskFile)) {
      return json({ error: "No file uploaded" }, { status: 400 });
    }

    const mimeType = file.type;
    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
      return json({ error: "Only image and video files can be added to a post." }, { status: 415 });
    }

    const filepath = file.getFilePath();
    const filename = tempFiles.get(filepath) ?? file.name;
    const sizeBytes = file.size;

    const uploaded = await uploadToShopifyFiles(admin, { filepath, filename, mimeType });

    let { width, height } = uploaded;
    // Shopify reports dimensions for images it has processed; measure locally
    // only if it did not (and only while the temp file still exists).
    if (mimeType.startsWith("image/") && (width === undefined || height === undefined)) {
      try {
        const meta = await sharp(filepath).metadata();
        width = width ?? meta.width;
        height = height ?? meta.height;
      } catch {
        // Non-fatal: the asset is usable without dimensions.
      }
    }

    return json({
      url: uploaded.url,
      mimeType,
      sizeBytes,
      width,
      height,
    });
  } catch (error) {
    if (error instanceof ShopifyFileUploadError) {
      return json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Response) throw error;
    console.error("[api.upload] Shopify Files upload failed", error);
    return json({ error: "The file could not be uploaded. Please try again." }, { status: 500 });
  } finally {
    await cleanUp();
  }
};
