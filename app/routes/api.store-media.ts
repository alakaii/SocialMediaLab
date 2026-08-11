import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import shopify from "../shopify.server.js";
import { getStoreMedia } from "../services/store-media.server.js";

/**
 * Returns reusable store images (linked product images and its variant images
 * first, then collection and blog article images) for the "From your store"
 * media tab. Variant images carry their variantId and variantTitle so the picker
 * can surface the image of the variant a post links to.
 * Query params: productId? (Shopify product GID), query? (collection search).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await shopify.authenticate.admin(request);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  const query = url.searchParams.get("query");

  const images = await getStoreMedia(admin, { productId, query });

  return json({ images });
};
