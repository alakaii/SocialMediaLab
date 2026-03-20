import type { ActionFunctionArgs } from "@remix-run/node";
import { json, unstable_parseMultipartFormData, unstable_createFileUploadHandler } from "@remix-run/node";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "../../public/uploads");

export const action = async ({ request }: ActionFunctionArgs) => {
  const uploadHandler = unstable_createFileUploadHandler({
    directory: UPLOAD_DIR,
    maxPartSize: 500 * 1024 * 1024, // 500MB
  });

  const formData = await unstable_parseMultipartFormData(request, uploadHandler);
  const file = formData.get("file") as { name: string; filepath: string; type: string; size: number } | null;

  if (!file) {
    return json({ error: "No file uploaded" }, { status: 400 });
  }

  const url = `/uploads/${path.basename(file.filepath)}`;
  let width: number | undefined;
  let height: number | undefined;

  if (file.type.startsWith("image/")) {
    try {
      const meta = await sharp(file.filepath).metadata();
      width = meta.width;
      height = meta.height;
    } catch {
      // Non-fatal
    }
  }

  return json({
    url,
    mimeType: file.type,
    sizeBytes: file.size,
    width,
    height,
  });
};
