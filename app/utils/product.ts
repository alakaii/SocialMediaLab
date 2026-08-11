/**
 * Helpers for the storefront links the composer builds from a linked product.
 * Shopify hands us GIDs (gid://shopify/ProductVariant/456) while the storefront
 * expects the plain numeric id in ?variant=, so the conversion lives here.
 */

/** Variant title Shopify gives a product that has no real variants. */
export const DEFAULT_VARIANT_TITLE = "Default Title";

/**
 * Numeric tail of a Shopify GID, or null when the id is not a GID we recognise
 * (so callers fall back to a plain product link rather than a broken one).
 */
export function numericIdFromGid(gid: string): string | null {
  const tail = gid.split("/").pop();
  return tail && /^\d+$/.test(tail) ? tail : null;
}

/**
 * Storefront URL for a linked product. When a variant is given, the numeric
 * variant id is appended so the product page opens on that variant.
 */
export function buildProductUrl(
  shop: string,
  handle: string,
  variantGid?: string | null,
): string {
  const base = `https://${shop}/products/${handle}`;
  const variantId = variantGid ? numericIdFromGid(variantGid) : null;
  return variantId ? `${base}?variant=${variantId}` : base;
}

/** Bare domain of a URL, for link-preview style cards. */
export function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
