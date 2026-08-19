/**
 * Feature-tier resolution for Shopify App Pricing.
 *
 * The app used to sell through the Billing API (`appSubscriptionCreate` and
 * friends). That API has been legacy since May 2026, and enabling App Pricing
 * disables it outright, so none of it survives here. Under App Pricing the plan
 * catalogue, the selection page and the charge all belong to Shopify; the app's
 * whole job is to redirect merchants to the hosted page and read back what they
 * chose.
 *
 * Reading back is the delicate part. App Pricing sends no webhooks, so state is
 * pulled from the Partner API on page load and cached in ShopBilling. The rule
 * that governs every branch below: only a definitive "no contract" answer is
 * allowed to take features away. A network failure, a missing credential or a
 * rejected query all mean "we do not know", and a shop that already had a tier
 * keeps it.
 */

import { prisma } from "./db.server.js";
import {
  fetchActiveSubscription,
  type PartnerSubscription,
} from "./services/partner.server.js";

/** Route that shows the plan. Must never sit behind the tier gate. */
export const BILLING_PLAN_PATH = "/app/billing";

/** No subscription: every page except the plan page is locked. */
export const TIER_NONE = "none";

/**
 * The one paid tier this app currently sells. The mapping table exists so real
 * tiers can appear later without a release, but today every contract lands here.
 */
export const TIER_FULL = "full";

/** Where a tier came from, for support and for the owner surface. */
export type TierSource = "app_pricing" | "legacy" | "none";

/**
 * How long a stored tier is trusted before the Partner API is consulted again.
 *
 * Every page under /app resolves the tier, so without this a single merchant
 * clicking through the app would spend the 4 req/s Partner budget on its own.
 */
const SYNC_THROTTLE_MS = 60_000;

/**
 * Minimal shape of the admin GraphQL client from `authenticate.admin`.
 * Declared locally so this module does not depend on the Shopify package's
 * generic-heavy context types.
 */
export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export interface ResolvedTier {
  tier: string;
  planHandle: string | null;
  source: string;
  /**
   * The contract as the Partner API just described it, for the plan page to
   * render. Null whenever this call did not reach the Partner API (throttled,
   * failed, or unconfigured), which is why the plan page must be able to fall
   * back to the stored handle.
   */
  subscription: PartnerSubscription | null;
}

// The unconfigured warning is loud but printed once, so a misconfigured deploy
// is obvious in the logs without every page load burying everything else.
let warnedUnconfigured = false;

const SHOP_GID_QUERY = `#graphql
  query ShopGid {
    shop {
      id
    }
  }
`;

const LEGACY_SUBSCRIPTIONS_QUERY = `#graphql
  query LegacyAppSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

/**
 * Read the shop's GID through the Admin API.
 *
 * The Partner API identifies shops by GID and accepts nothing else, so this is
 * the bridge between the two APIs. Returns null on any failure; the caller
 * treats a missing GID as "cannot sync", never as "not subscribed".
 */
export async function fetchShopGid(
  admin: AdminGraphqlClient,
): Promise<string | null> {
  try {
    const response = await admin.graphql(SHOP_GID_QUERY);
    const payload = (await response.json()) as {
      data?: { shop?: { id?: string | null } | null } | null;
    };
    const id = payload.data?.shop?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch (err) {
    console.error("[billing] could not read the shop GID", err);
    return null;
  }
}

/**
 * Whether the shop still holds a legacy Billing API subscription.
 *
 * The Partner API reports App Pricing contracts only, so a store that
 * subscribed before the migration looks like "no contract" there while still
 * paying. Returns null when the question could not be answered, which the
 * caller must treat as "do not downgrade".
 */
async function hasActiveLegacySubscription(
  admin: AdminGraphqlClient,
): Promise<boolean | null> {
  try {
    const response = await admin.graphql(LEGACY_SUBSCRIPTIONS_QUERY);
    const payload = (await response.json()) as {
      data?: {
        currentAppInstallation?: {
          activeSubscriptions?: Array<{ status?: string | null }> | null;
        } | null;
      } | null;
      errors?: unknown;
    };
    if (payload.errors || !payload.data?.currentAppInstallation) {
      console.error(
        "[billing] legacy subscription check failed",
        payload.errors ?? "no currentAppInstallation in response",
      );
      return null;
    }
    const subscriptions = payload.data.currentAppInstallation.activeSubscriptions ?? [];
    return subscriptions.some((sub) => sub?.status === "ACTIVE");
  } catch (err) {
    console.error("[billing] legacy subscription check errored", err);
    return null;
  }
}

/**
 * Map a contract's plan handles to a feature tier.
 *
 * Handles are the internal names from the Partner Dashboard, not the display
 * names merchants see, and the dashboard can grow plans this code has never
 * heard of (private plans, promo plans). PlanTierMapping is the override point
 * for those: a row beats a release.
 *
 * An unmapped handle grants TIER_FULL rather than holding the current tier.
 * This app sells a single feature tier, so the merchant is paying for all of it
 * whatever the handle says, and locking a paying merchant out is the only harm
 * available here. The loud log is what turns an unmapped handle into a mapping
 * row later.
 */
async function tierForHandles(
  planHandles: string[],
): Promise<{ tier: string; planHandle: string | null }> {
  for (const handle of planHandles) {
    const mapping = await prisma.planTierMapping.findUnique({
      where: { planHandle: handle },
    });
    if (mapping) return { tier: mapping.tier, planHandle: handle };
  }

  const handle = planHandles[0] ?? null;
  console.error(
    "[billing] unmapped plan handle",
    handle ?? "(contract reported no plan handles)",
  );
  return { tier: TIER_FULL, planHandle: handle };
}

/**
 * Resolve (and cache) the feature tier for one shop.
 *
 * Safe to call on every request: the Partner read is throttled, and every exit
 * writes the outcome back to ShopBilling so the next call has something to fall
 * back on.
 */
export async function resolveTier(opts: {
  shop: string;
  admin: AdminGraphqlClient;
  /** Skip the throttle. Used when Shopify has just sent the merchant back. */
  force?: boolean;
}): Promise<ResolvedTier> {
  const { shop, admin, force = false } = opts;

  const record = await prisma.shopBilling.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });

  const storedTier = record.tier || TIER_NONE;
  const storedHandle = record.planHandle ?? null;
  const storedSource = record.tierSource || "none";

  // Every exit persists, so the next request has a cached answer even if this
  // one only learned that the Partner API is unreachable.
  const persist = async (next: {
    tier: string;
    planHandle: string | null;
    source: TierSource;
    lastSyncOk: boolean;
    subscription?: PartnerSubscription | null;
  }): Promise<ResolvedTier> => {
    await prisma.shopBilling.update({
      where: { shop },
      data: {
        tier: next.tier,
        planHandle: next.planHandle,
        tierSource: next.source,
        lastSyncAt: new Date(),
        lastSyncOk: next.lastSyncOk,
      },
    });
    return {
      tier: next.tier,
      planHandle: next.planHandle,
      source: next.source,
      subscription: next.subscription ?? null,
    };
  };

  // The Partner API only accepts GIDs. afterAuth captures this at install; the
  // lookup here covers shops installed before that hook existed.
  let shopGid = record.shopGid;
  if (!shopGid) {
    shopGid = await fetchShopGid(admin);
    if (shopGid) {
      await prisma.shopBilling.update({ where: { shop }, data: { shopGid } });
    }
  }

  if (!force && record.lastSyncAt) {
    const age = Date.now() - record.lastSyncAt.getTime();
    if (age < SYNC_THROTTLE_MS) {
      return {
        tier: storedTier,
        planHandle: storedHandle,
        source: storedSource,
        subscription: null,
      };
    }
  }

  const read = await fetchActiveSubscription(shopGid);

  // --- "We do not know" ------------------------------------------------------
  if (read.status === "unconfigured" || read.status === "error") {
    if (read.status === "unconfigured" && !warnedUnconfigured) {
      warnedUnconfigured = true;
      console.error(
        "[billing] Partner API is not configured (SHOPIFY_PARTNER_API_TOKEN, " +
          "SHOPIFY_PARTNER_ORG_ID, SHOPIFY_APP_GID). Subscription state cannot " +
          "be read, so every shop keeps whatever tier it already has.",
      );
    } else if (read.status === "error") {
      console.error("[billing] subscription read failed for", shop, read.reason);
    }

    // A shop that already has a tier keeps it. No exceptions: this is the
    // branch that protects paying merchants from an outage.
    if (storedTier !== TIER_NONE) {
      return persist({
        tier: storedTier,
        planHandle: storedHandle,
        source: (storedSource as TierSource) || "none",
        lastSyncOk: false,
      });
    }

    // Nothing stored yet, so there is nothing to protect. A fresh install may
    // still be carrying a legacy Billing API subscription, which the Partner
    // API would never report, so check that before settling on "none".
    const legacy = await hasActiveLegacySubscription(admin);
    if (legacy === true) {
      return persist({
        tier: TIER_FULL,
        planHandle: storedHandle,
        source: "legacy",
        lastSyncOk: true,
      });
    }
    return persist({
      tier: TIER_NONE,
      planHandle: null,
      source: "none",
      lastSyncOk: false,
    });
  }

  // --- A live App Pricing contract -------------------------------------------
  if (read.subscription) {
    const { tier, planHandle } = await tierForHandles(read.subscription.planHandles);
    return persist({
      tier,
      planHandle,
      source: "app_pricing",
      lastSyncOk: true,
      subscription: read.subscription,
    });
  }

  // --- Definitively no App Pricing contract ----------------------------------
  // The only branch allowed to downgrade, and even here the legacy system gets
  // asked first: migrating apps have to check both, because the Partner API
  // reports App Pricing contracts only.
  const legacy = await hasActiveLegacySubscription(admin);
  if (legacy === true) {
    return persist({
      tier: TIER_FULL,
      planHandle: storedHandle,
      source: "legacy",
      lastSyncOk: true,
    });
  }
  if (legacy === null) {
    // Partner says no, the Admin API would not answer. Not definitive enough to
    // take a legacy subscriber's features away.
    return persist({
      tier: storedTier,
      planHandle: storedHandle,
      source: (storedSource as TierSource) || "none",
      lastSyncOk: false,
    });
  }

  return persist({
    tier: TIER_NONE,
    planHandle: null,
    source: "none",
    lastSyncOk: true,
  });
}

/**
 * Shopify's hosted plan selection page for this shop.
 *
 * There is no per-plan deep link and no API to render the catalogue, so this
 * URL is the entire subscribe flow. The page refuses to be iframed, so links to
 * it must open with `target="_top"`.
 *
 * The app handle is not the App Store listing slug; the two can differ (verify
 * with `currentAppInstallation { app { handle } }`). An unset env var throws
 * rather than building a URL that 404s, because a dead subscribe button is far
 * harder to notice than a crashed page.
 */
export function hostedPlanPageUrl(shop: string): string {
  const appHandle = process.env.SHOPIFY_APP_HANDLE?.trim();
  if (!appHandle) {
    throw new Error(
      "SHOPIFY_APP_HANDLE is not set, so the hosted plan page URL cannot be " +
        "built. Read the handle from the Admin API (currentAppInstallation " +
        "{ app { handle } }) and set it in the server environment. It is the " +
        "app handle, not the App Store listing slug.",
    );
  }
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}
