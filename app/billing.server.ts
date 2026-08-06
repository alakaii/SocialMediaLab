import { BillingInterval } from "@shopify/shopify-app-remix/server";
import type { shopifyApp } from "@shopify/shopify-app-remix/server";

/**
 * Billing configuration for the app.
 *
 * This module must NOT import from `shopify.server.ts` — it is imported *by*
 * `shopify.server.ts`, which spreads `BILLING_CONFIG` into `shopifyApp({ billing })`.
 * Once wired, `const { billing } = await authenticate.admin(request)` exposes
 * `require` / `request` / `check` / `cancel` for the plan below.
 *
 * Shopify is the source of truth for subscription state — we deliberately keep
 * no local database model for it and read it back via `billing.check`.
 */

/** The single recurring plan the app sells. Also the plan name shown in the Shopify admin. */
export const MONTHLY_PLAN = "Monthly subscription";

/** Price charged every 30 days. */
export const MONTHLY_PLAN_AMOUNT = 14.99;

/** Currency the plan is billed in. */
export const MONTHLY_PLAN_CURRENCY = "USD";

/** Free trial length, in days, before the first charge. */
export const MONTHLY_PLAN_TRIAL_DAYS = 14;

/** Route that shows the plan and starts a subscription. Must never be behind the billing gate. */
export const BILLING_PLAN_PATH = "/app/billing";

/**
 * Matches the `billing` option of `shopifyApp()`.
 *
 * `@shopify/shopify-app-remix` v3 forces the `lineItemBilling` API future flag on,
 * so the plan must use the `lineItems` shape rather than the legacy flat
 * `{ amount, currencyCode, interval }` shape.
 *
 * Left unannotated on purpose: the literal key type is what makes
 * `billing.require({ plans: [MONTHLY_PLAN] })` type-check.
 */
export const BILLING_CONFIG = {
  [MONTHLY_PLAN]: {
    trialDays: MONTHLY_PLAN_TRIAL_DAYS,
    lineItems: [
      {
        amount: MONTHLY_PLAN_AMOUNT,
        currencyCode: MONTHLY_PLAN_CURRENCY,
        // `as const` keeps the enum member's literal type — without it TypeScript
        // widens to `BillingInterval` and the recurring line item stops matching.
        interval: BillingInterval.Every30Days as const,
      },
    ],
  },
};

// Compile-time check that the shape above is what shopifyApp() accepts, without
// widening the object's key type.
type ShopifyAppBillingConfig = NonNullable<
  Parameters<typeof shopifyApp>[0]["billing"]
>;
const _billingConfigShapeCheck: ShopifyAppBillingConfig = BILLING_CONFIG;
void _billingConfigShapeCheck;

/**
 * Whether to create test charges (no real money moves).
 *
 * Real charges only in production, and even there `BILLING_TEST=true` forces test
 * mode so a production deploy can be exercised against a dev store safely.
 */
export function isTestBilling(): boolean {
  return (
    process.env.NODE_ENV !== "production" || process.env.BILLING_TEST === "true"
  );
}

/**
 * Absolute URL Shopify sends the merchant back to after they approve the charge.
 * Carries `shop`/`host` through so the app can re-embed itself in the admin.
 */
export function billingReturnUrl(request: Request, shop: string): string {
  const requestUrl = new URL(request.url);
  const returnUrl = new URL(
    "/app",
    process.env.SHOPIFY_APP_URL ?? requestUrl.origin,
  );
  returnUrl.searchParams.set("shop", shop);

  const host = requestUrl.searchParams.get("host");
  if (host) {
    returnUrl.searchParams.set("host", host);
  }

  return returnUrl.toString();
}
