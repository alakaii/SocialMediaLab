import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import shopify from "../shopify.server.js";
import { prisma } from "../db.server.js";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await shopify.authenticate.webhook(request);

  await prisma.session.deleteMany({ where: { shop } });

  return json({ ok: true });
};
