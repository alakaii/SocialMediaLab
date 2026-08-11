/**
 * Media added before the Shopify Files migration was written to the app
 * container's disk and stored as a relative "/uploads/..." URL. Those files are
 * gone (Railway wipes the disk on every deploy) and a relative URL cannot be
 * fetched by the worker or by a social platform's API, so the adapters throw
 * "Failed to parse URL" on them.
 *
 * Anything that is not an absolute http(s) URL is treated as unavailable, both
 * by the publishing worker (which fails the platform with a plain explanation
 * instead of retrying forever) and by the post detail page (which shows a
 * warning instead of a broken image).
 */
export function isFetchableMediaUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Shown to the merchant, so it says what to do rather than what broke. */
export const LEGACY_MEDIA_UNAVAILABLE_MESSAGE =
  "This post's media was uploaded before cloud storage was enabled and is no longer available. Edit the post and re-add its media.";
