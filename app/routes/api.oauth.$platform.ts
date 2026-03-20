import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import shopify from "../shopify.server.js";
import { buildOAuthUrl } from "../services/oauth.server.js";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await shopify.authenticate.admin(request);
  const url = new URL(request.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId) throw new Response("Missing brandId", { status: 400 });

  const baseUrl = `${url.protocol}//${url.host}`;
  const authUrl = buildOAuthUrl(params.platform!, brandId, baseUrl);
  return redirect(authUrl);
};
