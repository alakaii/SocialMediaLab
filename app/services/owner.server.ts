/**
 * The owner-only surface: who gets in, and the global banner it publishes.
 *
 * "Owner" here means the single store that operates this app (ours), not a
 * merchant role. It reaches pages no merchant may see: the plan handle to
 * feature tier mappings, the billing state of every installed shop, and the
 * banner shown at the top of every merchant's admin.
 *
 * Two rules this module exists to enforce:
 *
 * 1. An unset APP_OWNER_SHOP means nobody, never everybody. A deploy that
 *    forgets the variable must lock the owner out, not let the world in.
 * 2. Refusal is a 404, not a 403. A 403 tells whoever knocked that the route
 *    is real and that they found the right URL; a 404 says nothing at all.
 */

import { prisma } from "../db.server.js";

/**
 * The owner store's full domain (for example "example.myshopify.com"), or null
 * when the variable is unset or blank.
 */
export function ownerShopDomain(): string | null {
  const configured = process.env.APP_OWNER_SHOP?.trim().toLowerCase();
  return configured ? configured : null;
}

/**
 * Whether this shop domain is the owner store. False whenever the variable is
 * unset, so a missing config denies everyone rather than admitting everyone.
 */
export function isOwnerShop(shop: string): boolean {
  const owner = ownerShopDomain();
  if (!owner) return false;
  return shop.trim().toLowerCase() === owner;
}

/**
 * Gate for the owner routes. Throws a bare 404 Response for anyone else, which
 * Remix returns as-is, so a probing merchant learns only that nothing lives at
 * this URL. Call it in the loader AND in the action: a hidden nav item is not a
 * lock, and an action is just a URL anyone can POST to.
 */
export function requireOwnerShop(shop: string): void {
  if (!isOwnerShop(shop)) {
    throw new Response("Not Found", { status: 404 });
  }
}

/**
 * The banner the app shell renders above every merchant's page, or null when
 * nothing is being announced.
 *
 * The table holds at most one row (the owner surface upserts the first one), so
 * this reads the singleton and returns it only while it is active. This is the
 * outage and maintenance channel: it has to work with no deploy, which is why
 * the message lives in the database rather than in the code.
 */
export async function getActiveGlobalBanner(): Promise<{
  message: string;
  tone: string;
} | null> {
  const banner = await prisma.globalBanner.findFirst();
  if (!banner || !banner.active || !banner.message.trim()) return null;
  return { message: banner.message, tone: banner.tone };
}
