import { prisma } from "../db.server.js";
import { removeJob } from "../queue.server.js";

/**
 * GDPR / mandatory compliance webhook logic.
 *
 * This app stores no end-customer (shopper) data: nothing in the schema is keyed
 * to a customer id, email, or order. Everything we persist is merchant-owned
 * (brands, connected social accounts, posts, media, hashtag memory, settings and
 * the Shopify session). So the customer-scoped topics have nothing to return or
 * erase, and only `shop/redact` performs a real deletion.
 */

/**
 * `customers/data_request` - a shopper asked for the data we hold on them.
 *
 * We hold none, so there is nothing to hand back to the merchant. We log the
 * request so there is an audit trail if Shopify or the merchant follows up.
 */
export function logCustomerDataRequest(shop: string, payload: Record<string, any>) {
  console.log("[gdpr] customers/data_request", {
    shop,
    customerId: payload?.customer?.id ?? null,
    ordersRequested: payload?.orders_requested ?? [],
    dataRequestId: payload?.data_request?.id ?? null,
    note: "no customer data stored by this app; nothing to provide",
  });
}

/**
 * `customers/redact` - a shopper asked for their data to be erased.
 *
 * We hold none, so there is nothing to delete. Logged for the audit trail.
 */
export function logCustomerRedact(shop: string, payload: Record<string, any>) {
  console.log("[gdpr] customers/redact", {
    shop,
    customerId: payload?.customer?.id ?? null,
    ordersToRedact: payload?.orders_to_redact ?? [],
    note: "no customer data stored by this app; nothing to erase",
  });
}

/**
 * Best-effort removal of every queued BullMQ job belonging to a shop's posts.
 *
 * Called before the rows are deleted so the worker never wakes up to a post that
 * no longer exists. Redis being unavailable must never fail the webhook: Shopify
 * retries on a non-2xx and the DB purge is the part that legally matters, so
 * failures here are logged and swallowed. Orphaned jobs are harmless anyway -
 * the worker no-ops when the post row is gone.
 */
async function cancelQueuedJobsForShop(shop: string) {
  const posts = await prisma.post.findMany({
    where: { shop },
    select: {
      bullJobId: true,
      platformPosts: { select: { bullJobId: true } },
    },
  });

  const jobIds = new Set<string>();
  for (const post of posts) {
    if (post.bullJobId) jobIds.add(post.bullJobId);
    for (const platformPost of post.platformPosts) {
      if (platformPost.bullJobId) jobIds.add(platformPost.bullJobId);
    }
  }

  for (const jobId of jobIds) {
    try {
      await removeJob(jobId);
    } catch (error) {
      console.error("[gdpr] failed to remove queued job during shop/redact", {
        shop,
        jobId,
        error,
      });
    }
  }
}

/**
 * `shop/redact` - fired 48h after uninstall. Erase everything we hold for the shop.
 *
 * Deletion order is FK-safe: Posts go first (cascading PostPlatform and
 * MediaAsset) because Post -> Brand has no cascade, then SocialAccount (cascading
 * BrandSocialAccount), then the remaining shop-scoped tables and the session.
 */
export async function purgeShopData(shop: string) {
  try {
    await cancelQueuedJobsForShop(shop);
  } catch (error) {
    // Redis unreachable, or the lookup itself failed. Never block the purge.
    console.error("[gdpr] queue cleanup failed during shop/redact", { shop, error });
  }

  const deleted = await prisma.$transaction(async (tx) => {
    // Cascades PostPlatform and MediaAsset.
    const posts = await tx.post.deleteMany({ where: { shop } });
    // Cascades BrandSocialAccount.
    const socialAccounts = await tx.socialAccount.deleteMany({ where: { shop } });
    const brands = await tx.brand.deleteMany({ where: { shop } });
    const productHashtags = await tx.productHashtag.deleteMany({ where: { shop } });
    const shopSettings = await tx.shopSettings.deleteMany({ where: { shop } });
    const sessions = await tx.session.deleteMany({ where: { shop } });

    return {
      posts: posts.count,
      socialAccounts: socialAccounts.count,
      brands: brands.count,
      productHashtags: productHashtags.count,
      shopSettings: shopSettings.count,
      sessions: sessions.count,
    };
  });

  console.log("[gdpr] shop/redact purge complete", { shop, deleted });

  return deleted;
}
