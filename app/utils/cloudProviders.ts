/**
 * Cloud storage services a merchant can pull post media from ("From cloud" tab).
 *
 * Only Dropbox has a picker today. The rest are listed so merchants can see what
 * is coming, and so turning one on later is purely additive: flip `enabled` here
 * and add its branch to CloudMediaPicker. Nothing else keys off provider ids.
 *
 * Client-safe: the wizard components and the api.cloud-import route both import
 * from this module, so it must never pull in server-only code.
 */

export type CloudProviderId = "dropbox" | "google_drive" | "onedrive" | "box";

export interface CloudProvider {
  id: CloudProviderId;
  label: string;
  /** Emoji shown on the provider button, matching the platform icons elsewhere. */
  icon: string;
  /** False renders the button disabled with a "Coming soon" badge. */
  enabled: boolean;
}

export const CLOUD_PROVIDERS: CloudProvider[] = [
  { id: "dropbox", label: "Dropbox", icon: "📦", enabled: true },
  { id: "google_drive", label: "Google Drive", icon: "🗂️", enabled: false },
  { id: "onedrive", label: "OneDrive", icon: "☁️", enabled: false },
  { id: "box", label: "Box", icon: "🗃️", enabled: false },
];

/**
 * Files accepted per import call. The route fetches each file server-side and
 * pushes it to Shopify Files, so a batch is real work: the cap keeps one click
 * from tying up a request for minutes.
 */
export const CLOUD_IMPORT_MAX_FILES = 10;

/** Everything the pickers offer by default. Callers narrow this per post type. */
export const CLOUD_MEDIA_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".mp4",
  ".mov",
];

/** One file the merchant picked, as sent to /api/cloud-import. */
export interface CloudImportRequestFile {
  /** Temporary direct link from the provider's picker. */
  url: string;
  name: string;
}

/**
 * Per-file outcome. A failure never fails the batch, so a single unreadable file
 * does not cost the merchant the other nine.
 */
export type CloudImportResult =
  | {
      ok: true;
      name: string;
      /** Permanent Shopify CDN URL, same as /api/upload returns. */
      url: string;
      mimeType: string;
      sizeBytes: number;
      width?: number;
      height?: number;
    }
  | { ok: false; name: string; error: string };

/** Body of a /api/cloud-import response: per-file results, or a whole-batch error. */
export interface CloudImportResponse {
  results?: CloudImportResult[];
  error?: string;
}
