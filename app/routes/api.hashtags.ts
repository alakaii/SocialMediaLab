import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import shopify from "../shopify.server.js";
import { getProductHashtags } from "../services/hashtag.server.js";

/**
 * Returns the most-used hashtags for a linked product in this shop, ranked by
 * usage. Powers the clickable hashtag suggestion chips in the wizard.
 * Query param: productId (required, Shopify product GID).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  if (!productId) {
    return json({ hashtags: [] });
  }

  const hashtags = await getProductHashtags(session.shop, productId);
  return json({ hashtags });
};
