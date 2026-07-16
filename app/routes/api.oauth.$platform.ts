import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import shopify from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { buildOAuthUrl, oauthStateCookie } from "../services/oauth.server.js";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const url = new URL(request.url);
  const brandId = url.searchParams.get("brandId");
  if (!brandId) throw new Response("Missing brandId", { status: 400 });

  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.shop !== session.shop) {
    throw new Response("Brand not found", { status: 404 });
  }

  const baseUrl = `${url.protocol}//${url.host}`;
  const { url: authUrl, state } = buildOAuthUrl(params.platform!, brandId, baseUrl);

  return redirect(authUrl, {
    headers: {
      "Set-Cookie": await oauthStateCookie.serialize(state),
    },
  });
};
