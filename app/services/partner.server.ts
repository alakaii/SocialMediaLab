/**
 * The Partner API side of Shopify App Pricing.
 *
 * Under App Pricing, Shopify owns the plan catalogue, the hosted selection page
 * and the charge. The one thing it does not do is tell the app: App Pricing
 * contracts send no app_subscriptions/update webhook, and the Admin API's
 * currentAppInstallation reports only legacy Billing API subscriptions. The
 * Partner API's activeSubscription query is the only way to learn what a store
 * is paying for, so this module is that one call.
 *
 * Transport only, on purpose. What a plan handle *means* is billing policy and
 * lives in billing.server.ts, which imports this module; importing the mapping
 * back the other way would be a cycle.
 */

/** Everything billing.server needs out of one App Pricing contract. */
export interface PartnerSubscription {
  /**
   * Internal handles of every line on the contract, in the order the API
   * returned them. Handles, not display names: the two differ, and only the
   * handle is stable.
   */
  planHandles: string[];
  /** Human text for the first line, when the contract carries one. */
  planName?: string;
  /** Flat-rate amount of the first priced line. Absent for usage-only lines. */
  priceAmount?: number;
  /** Currency of `priceAmount`. Absent whenever `priceAmount` is. */
  priceCurrency?: string;
  /** ISO timestamp; present only while the contract is still in its trial. */
  trialEndsAt?: string;
  /** EVERY_30_DAYS or ANNUAL, when reported. */
  billingPeriod?: string;
  /** True once the merchant has cancelled but the paid period is still running. */
  cancelAtEndOfCycle?: boolean;
}

/**
 * The result of one Partner read.
 *
 * The distinction that matters: `{ status: "ok", subscription: null }` is the
 * API definitively saying "this shop has no App Pricing contract", and is the
 * only answer allowed to downgrade a store. Both "error" and "unconfigured"
 * mean "we do not know" and must leave the stored tier alone, because a Partner
 * API outage taking a paying merchant's features away is the worst failure this
 * code can have.
 */
export type PartnerSubscriptionRead =
  | { status: "ok"; subscription: PartnerSubscription | null }
  | { status: "error"; reason: string }
  | { status: "unconfigured" };

/** activeSubscription ships in 2026-07; earlier versions do not have it. */
const PARTNER_API_VERSION = "2026-07";

/**
 * Verified against the Partner 2026-07 schema.
 * Docs: https://shopify.dev/docs/api/partner/2026-07/queries/activeSubscription
 *
 * Two shapes worth noting, both easy to get wrong:
 *  - the line items live on `items`, not `lineItems`, and the plan handle sits
 *    directly on the item rather than under a nested `plan { ... }` object;
 *  - on FlatRatePrice the currency field is `currency`, not `currencyCode`.
 *
 * TODO(live verification): this query has been checked against the published
 * 2026-07 schema but has not yet been run against the real Partner API with a
 * live contract. Confirm at publication time (playbook section 6, step 6) by
 * subscribing the owner store to a $0 private plan and logging the raw payload.
 */
const ACTIVE_SUBSCRIPTION_QUERY = `
  query SocialMediaLabActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      billingPeriod
      cancelAtEndOfCycle
      trialEndsAt
      items {
        handle
        description
        price {
          __typename
          ... on FlatRatePrice {
            amount
            currency
          }
        }
      }
    }
  }
`;

interface PartnerConfig {
  token: string;
  organizationId: string;
  appGid: string;
}

/**
 * Everything the Partner call needs, or null while any of it is missing.
 *
 * Read per call rather than at module load, so a variable added to the running
 * service is picked up on the next request instead of needing a restart.
 */
function partnerConfig(): PartnerConfig | null {
  const token = process.env.SHOPIFY_PARTNER_API_TOKEN || "";
  const organizationId = process.env.SHOPIFY_PARTNER_ORG_ID || "";
  const appGid = process.env.SHOPIFY_APP_GID || "";
  if (!token || !organizationId || !appGid) return null;
  return { token, organizationId, appGid };
}

/** Whether the Partner API credentials are present. */
export function partnerApiConfigured(): boolean {
  return partnerConfig() !== null;
}

// --- Rate limiting -----------------------------------------------------------
// The Partner API allows 4 requests per second per client and answers 429 past
// that. Requests are queued through a single promise chain with a minimum gap,
// so a burst of merchants loading the app at once spaces itself out instead of
// tripping the limit. Deliberately no retry: an over-limit read returns "error"
// (which never downgrades anyone) rather than adding load to a service that is
// already pushing back.
const MIN_REQUEST_GAP_MS = 260;
let requestChain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(task: () => Promise<T>): Promise<T> {
  const run = requestChain.then(async () => {
    const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
    return task();
  });
  // Keep the chain alive even when a link rejects, otherwise one failure
  // wedges every later request.
  requestChain = run.catch(() => undefined);
  return run;
}

interface PartnerResponsePayload {
  data?: {
    activeSubscription?: {
      billingPeriod?: string | null;
      cancelAtEndOfCycle?: boolean | null;
      trialEndsAt?: string | null;
      items?: Array<{
        handle?: string | null;
        description?: string | null;
        price?: {
          __typename?: string | null;
          amount?: string | number | null;
          currency?: string | null;
        } | null;
      }> | null;
    } | null;
  } | null;
  errors?: unknown;
}

function describeErrors(errors: unknown): string {
  if (Array.isArray(errors)) {
    const messages = errors
      .map((entry) =>
        entry && typeof entry === "object" && "message" in entry
          ? String((entry as { message?: unknown }).message)
          : String(entry),
      )
      .filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  return "Partner API returned an errors body";
}

/**
 * Ask the Partner API what this shop's App Pricing contract says.
 *
 * The shop is identified by GID because that is all the Partner API accepts, so
 * a shop whose GID has not been captured yet reads as an error rather than as
 * "no contract".
 */
export async function fetchActiveSubscription(
  shopGid: string | null | undefined,
): Promise<PartnerSubscriptionRead> {
  const config = partnerConfig();
  if (!config) return { status: "unconfigured" };
  if (!shopGid) {
    return { status: "error", reason: "shop GID not captured yet" };
  }

  let payload: PartnerResponsePayload;
  try {
    const response = await schedule(() =>
      fetch(
        `https://partners.shopify.com/${config.organizationId}/api/${PARTNER_API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": config.token,
          },
          body: JSON.stringify({
            query: ACTIVE_SUBSCRIPTION_QUERY,
            variables: { appId: config.appGid, shopId: shopGid },
          }),
          // Page loads wait on this call. Better a stale tier than a page that
          // hangs through a Partner API outage.
          signal: AbortSignal.timeout(10_000),
        },
      ),
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const reason = `Partner API answered ${response.status}`;
      console.error("[partner]", reason, body.slice(0, 500));
      return { status: "error", reason };
    }

    payload = (await response.json()) as PartnerResponsePayload;
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "could not reach the Partner API";
    console.error("[partner] request failed", err);
    return { status: "error", reason };
  }

  // The Partner API answers 200 for what REST would call a 4xx, so an errors
  // body is the real failure signal. An errored read is never "no contract".
  if (payload.errors) {
    const reason = describeErrors(payload.errors);
    console.error("[partner] query rejected", reason);
    return { status: "error", reason };
  }
  if (!payload.data || !("activeSubscription" in payload.data)) {
    const reason = "Partner API returned no data";
    console.error("[partner]", reason);
    return { status: "error", reason };
  }

  const subscription = payload.data.activeSubscription;
  if (!subscription) return { status: "ok", subscription: null };

  const items = subscription.items ?? [];
  const planHandles = items
    .map((item) => (item.handle ?? "").trim())
    .filter((handle) => handle.length > 0);

  const priced = items.find(
    (item) =>
      item.price?.__typename === "FlatRatePrice" &&
      item.price?.amount !== null &&
      item.price?.amount !== undefined,
  );
  const rawAmount = priced?.price?.amount;
  const amount =
    typeof rawAmount === "string" ? Number.parseFloat(rawAmount) : rawAmount;
  const hasPrice = typeof amount === "number" && Number.isFinite(amount);
  const currency = priced?.price?.currency?.trim() || "";

  const planName = items.find((item) => (item.description ?? "").trim())
    ?.description;

  return {
    status: "ok",
    subscription: {
      planHandles,
      ...(planName ? { planName: planName.trim() } : {}),
      // Price and currency travel together: a bare number the plan page could
      // render without a currency is worse than showing nothing.
      ...(hasPrice && currency
        ? { priceAmount: amount, priceCurrency: currency }
        : {}),
      ...(subscription.trialEndsAt ? { trialEndsAt: subscription.trialEndsAt } : {}),
      ...(subscription.billingPeriod
        ? { billingPeriod: subscription.billingPeriod }
        : {}),
      ...(subscription.cancelAtEndOfCycle
        ? { cancelAtEndOfCycle: true }
        : {}),
    },
  };
}
