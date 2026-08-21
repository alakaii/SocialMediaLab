/**
 * Usage-based billing for Shopify App Pricing.
 *
 * The app sells one public plan: $0 base, free to install, plus a usage meter
 * that charges $2 per brand per month. A merchant with no brands pays nothing,
 * which is why the base price is zero rather than a minimum.
 *
 * Shopify does the arithmetic. The plan's meter (defined in the dashboard, not
 * here) is a flat rate of $2 per unit; this module's only job is to tell Shopify
 * how many units a shop used, once per period, by sending an App Event.
 *
 * Three properties of the App Events API shape everything below:
 *
 *  - There is NO read-back. Nothing can ask Shopify what it has already
 *    recorded, so the UsageEmission table is the app's only record of what was
 *    billed. Every decision this module makes, including the decision not to
 *    send, is written down.
 *  - Responses are 202 and validation is asynchronous. A 202 means "received",
 *    not "charged"; a meter handle that does not exist in the dashboard is
 *    accepted and silently dropped. The enable flag below is what keeps that
 *    from being a problem before the meter exists.
 *  - Billing idempotency keys are enforced permanently. A key Shopify has seen
 *    once can never charge again, so a duplicate send is harmless and a reused
 *    key carrying a different quantity is silently ignored. The key is derived
 *    from the period, never from a timestamp or a random value.
 *
 * Transport verified against:
 *   https://shopify.dev/docs/api/app-events/latest
 *   https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/build-billing-event
 *   https://shopify.dev/docs/apps/build/app-events
 *
 * Deliberately does not import billing.server or partner.server. The worker runs
 * this sweep and has no Partner API credentials, so everything here reads from
 * the ShopBilling cache the web app already maintains.
 */

import { createHash } from "node:crypto";
import { prisma } from "../db.server.js";

/** Flat rate the dashboard meter charges per unit. Copy of a dashboard value. */
export const BRAND_PRICE_USD = 2;

/** Default meter handle. Must match the event handle configured on the plan. */
const DEFAULT_EVENT_HANDLE = "brands";

/**
 * App Events API version. Separate from the Admin API version in
 * shopify.app.toml; the two version independently.
 */
const APP_EVENTS_API_VERSION = "2026-07";

const TOKEN_URL = "https://api.shopify.com/auth/access_token";

/**
 * Only "app_pricing" shops are billed. A shop on a legacy Billing API
 * subscription is already being charged through the old system, and an App Event
 * would bill it a second time.
 */
const TIER_SOURCE_APP_PRICING = "app_pricing";

/** Mirrors TIER_NONE in billing.server, duplicated to avoid importing it. */
const TIER_NONE = "none";

export type EmissionStatus = "pending" | "sent" | "dry_run" | "skipped" | "failed";

export interface SweepSummary {
  sent: number;
  dryRun: number;
  skipped: number;
  failed: number;
}

/**
 * What one shop's sweep did. "noop" means nothing was written, because the shop
 * is not billable through App Pricing or its period was already handled.
 */
export interface EmissionResult {
  shop: string;
  status: EmissionStatus | "noop";
  quantity: number;
  detail?: string;
}

/** Whether events are actually sent. Anything but exactly "true" is dry-run. */
export function usageBillingEnabled(): boolean {
  return process.env.USAGE_BILLING_ENABLED === "true";
}

/** The dashboard-defined event handle for the meter. */
export function usageEventHandle(): string {
  return process.env.SHOPIFY_USAGE_EVENT_HANDLE?.trim() || DEFAULT_EVENT_HANDLE;
}

/**
 * The period a usage event belongs to: a UTC calendar month, "YYYY-MM".
 *
 * A deliberate simplification, and an honest one. Shopify bills on the
 * merchant's own 30-day contract period, which starts whenever they subscribed
 * and almost never lines up with a calendar month. Following the real period
 * would mean reading each contract's billing dates from the Partner API, and the
 * worker (which runs this sweep) holds no Partner credentials by design.
 *
 * The consequence is real and worth stating plainly: a single Shopify invoice
 * can contain zero brand charges or two of them, depending on where the calendar
 * boundary falls inside that merchant's cycle. What does not drift is the rate.
 * Exactly one event is emitted per calendar month, so over any stretch of time
 * the merchant pays $2 per brand per month, no more and no less. The alternative
 * (per-contract periods) would bill the same total through a more accurate
 * schedule at the cost of a Partner API dependency in the worker and a ledger
 * nobody can audit by eye.
 */
export function periodKeyFor(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 64;

/**
 * The permanent key for one shop's one event in one period.
 *
 * Shopify remembers billing idempotency keys forever, so this being derived
 * purely from identity (never from a clock or a random value) is what makes a
 * double charge impossible even if the local unique constraint were bypassed.
 *
 * Shopify caps the key at 64 characters, and a .myshopify.com subdomain can be
 * up to 63 characters on its own (the DNS label limit), so the readable
 * "shop:handle:period" form does not always fit. When it does not, the shop
 * part is replaced by a sha256 prefix. Both forms are pure functions of the
 * same identity, and a shop's domain length does not change, so every shop
 * stays on one form for life; what matters is that the derivation never
 * changes once real events have been sent, because a new key for an
 * already-billed period would charge it again.
 */
export function idempotencyKeyFor(
  shop: string,
  eventHandle: string,
  periodKey: string,
): string {
  const readable = `${shop}:${eventHandle}:${periodKey}`;
  if (readable.length <= MAX_IDEMPOTENCY_KEY_LENGTH) return readable;
  const shopHash = createHash("sha256").update(shop).digest("hex").slice(0, 24);
  return `${shopHash}:${eventHandle}:${periodKey}`;
}

// --- Transport ---------------------------------------------------------------

interface AppEventsCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Credentials for the client-credentials grant.
 *
 * The docs describe an API key created in the Dev Dashboard, which is a distinct
 * credential from the app's own client id and secret. Both are accepted here:
 * the dedicated pair wins when it is set, and the app's own credentials are the
 * fallback so a deploy that has not created a separate key still works.
 *
 * Read per call rather than at module load, so a variable added to a running
 * service is picked up on the next sweep instead of needing a restart.
 */
function appEventsCredentials(): AppEventsCredentials | null {
  const clientId =
    process.env.SHOPIFY_APP_EVENTS_CLIENT_ID?.trim() ||
    process.env.SHOPIFY_API_KEY?.trim() ||
    "";
  const clientSecret =
    process.env.SHOPIFY_APP_EVENTS_CLIENT_SECRET?.trim() ||
    process.env.SHOPIFY_API_SECRET?.trim() ||
    "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// Tokens live 60 minutes. Cached in memory and refreshed a minute early, so a
// sweep over many shops pays for one token exchange rather than one per shop.
const TOKEN_REFRESH_MARGIN_MS = 60_000;
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const credentials = appEventsCredentials();
  if (!credentials) {
    throw new Error(
      "App Events credentials are missing (set SHOPIFY_APP_EVENTS_CLIENT_ID and " +
        "SHOPIFY_APP_EVENTS_CLIENT_SECRET, or SHOPIFY_API_KEY and SHOPIFY_API_SECRET)",
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `token exchange answered ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  const value = payload.access_token;
  if (!value) throw new Error("token exchange returned no access_token");

  const lifetimeMs = (payload.expires_in ?? 3_600) * 1_000;
  cachedToken = {
    value,
    expiresAt: Date.now() + Math.max(lifetimeMs - TOKEN_REFRESH_MARGIN_MS, 0),
  };
  return value;
}

/**
 * POST one App Event.
 *
 * Quantities here are always whole brand counts, so `value` goes on the wire as
 * an unquoted integer. Anything fractional would have to be a quoted string
 * instead (Shopify rejects unquoted floats to avoid rounding errors), which is
 * why this signature takes an integer and nothing else.
 *
 * Throws on any non-2xx. The caller records the message in the ledger.
 */
async function sendAppEvent(opts: {
  shopGid: string;
  eventHandle: string;
  idempotencyKey: string;
  quantity: number;
}): Promise<void> {
  if (!Number.isInteger(opts.quantity)) {
    throw new Error(`quantity must be an integer, got ${opts.quantity}`);
  }
  if (opts.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new Error(
      `idempotency key is ${opts.idempotencyKey.length} characters, over the ` +
        `${MAX_IDEMPOTENCY_KEY_LENGTH} character limit`,
    );
  }

  const token = await accessToken();
  const response = await fetch(
    `https://api.shopify.com/app/${APP_EVENTS_API_VERSION}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        shop_id: opts.shopGid,
        event_handle: opts.eventHandle,
        timestamp: new Date().toISOString(),
        idempotency_key: opts.idempotencyKey,
        attributes: { value: opts.quantity },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // A 401 usually means the cached token went stale early; drop it so the next
    // shop in the sweep exchanges a fresh one instead of failing the same way.
    if (response.status === 401) cachedToken = null;
    throw new Error(
      `App Events answered ${response.status}: ${body.slice(0, 300)}`,
    );
  }
}

// --- Emission ----------------------------------------------------------------

/**
 * Decide and record this period's usage for one shop.
 *
 * At most once per (shop, event handle, period), by construction: a row already
 * present means the period is settled and nothing else happens. That includes
 * rows left at "failed" or "pending", which are deliberately NOT retried
 * automatically. Retrying is safe (the permanent idempotency key cannot charge
 * twice), but it is a decision a person should make after reading the failure,
 * which is what the owner surface's ledger card is for.
 */
export async function emitUsageForShop(
  shop: string,
  now: Date = new Date(),
): Promise<EmissionResult> {
  const eventHandle = usageEventHandle();
  const periodKey = periodKeyFor(now);

  const billing = await prisma.shopBilling.findUnique({ where: { shop } });

  // Not billable through App Pricing. Legacy Billing API subscribers land here
  // too, and must: they are already being charged by the old system, so an App
  // Event would bill them twice. Nothing is recorded, so nothing has to be
  // cleaned up if they migrate later.
  if (!billing || billing.tier === TIER_NONE) {
    return { shop, status: "noop", quantity: 0, detail: "no active tier" };
  }
  if (billing.tierSource !== TIER_SOURCE_APP_PRICING) {
    return {
      shop,
      status: "noop",
      quantity: 0,
      detail: `tier source is "${billing.tierSource}", not App Pricing`,
    };
  }

  const existing = await prisma.usageEmission.findUnique({
    where: { shop_eventHandle_periodKey: { shop, eventHandle, periodKey } },
  });
  if (existing) {
    return {
      shop,
      status: "noop",
      quantity: existing.quantity,
      detail: `${periodKey} already recorded as "${existing.status}"`,
    };
  }

  const quantity = await prisma.brand.count({ where: { shop } });

  // Zero brands is the whole point of the $0 base price: there is nothing to
  // charge for, and sending a zero-value event would only add noise. Recorded
  // anyway, so the ledger shows the period was considered rather than missed.
  if (quantity === 0) {
    await prisma.usageEmission.create({
      data: {
        shop,
        periodKey,
        eventHandle,
        quantity: 0,
        idempotencyKey: idempotencyKeyFor(shop, eventHandle, periodKey),
        status: "skipped",
        detail: "no brands, nothing to charge",
      },
    });
    return { shop, status: "skipped", quantity: 0 };
  }

  // The Partner API only ever answers for a shop whose GID was captured, so a
  // shop with tierSource "app_pricing" has one. If that ever stops being true,
  // record nothing: a later sweep can pick the shop up once the GID arrives,
  // whereas a written row would block the period permanently.
  if (!billing.shopGid) {
    console.error(
      "[usage-billing] no shop GID for",
      shop,
      "so this period cannot be billed yet",
    );
    return { shop, status: "noop", quantity, detail: "shop GID not captured" };
  }

  const idempotencyKey = idempotencyKeyFor(shop, eventHandle, periodKey);
  const enabled = usageBillingEnabled();

  // The ledger row is written BEFORE the request, not after. A crash between the
  // two leaves a "pending" row whose unique constraint blocks a re-send, which
  // is the safe failure: a period billed once and recorded as uncertain beats a
  // period billed twice.
  const row = await prisma.usageEmission.create({
    data: {
      shop,
      periodKey,
      eventHandle,
      quantity,
      idempotencyKey,
      status: enabled ? "pending" : "dry_run",
      detail: enabled
        ? null
        : "USAGE_BILLING_ENABLED is not \"true\", so nothing was sent",
    },
  });

  if (!enabled) {
    return { shop, status: "dry_run", quantity };
  }

  try {
    await sendAppEvent({
      shopGid: billing.shopGid,
      eventHandle,
      idempotencyKey,
      quantity,
    });
    await prisma.usageEmission.update({
      where: { id: row.id },
      data: {
        status: "sent",
        sentAt: new Date(),
        // 202 is the only success Shopify returns here, and it means "received",
        // not "charged". Worth saying in the row rather than in a comment only.
        detail: "accepted (202); billing validation happens asynchronously",
      },
    });
    return { shop, status: "sent", quantity };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[usage-billing] send failed for", shop, detail);
    await prisma.usageEmission.update({
      where: { id: row.id },
      data: { status: "failed", detail: detail.slice(0, 500) },
    });
    return { shop, status: "failed", quantity, detail };
  }
}

/**
 * Run the emission for every shop that could owe something.
 *
 * Sequential on purpose. The sweep has all day to finish, and one shop's failure
 * must not take the rest of the run down with it.
 */
export async function runUsageSweep(now: Date = new Date()): Promise<SweepSummary> {
  const summary: SweepSummary = { sent: 0, dryRun: 0, skipped: 0, failed: 0 };

  const shops = await prisma.shopBilling.findMany({
    where: { tier: { not: TIER_NONE } },
    select: { shop: true },
    orderBy: { shop: "asc" },
  });

  for (const { shop } of shops) {
    let result: EmissionResult;
    try {
      result = await emitUsageForShop(shop, now);
    } catch (err) {
      // A throw here is a database problem, not a Shopify one, so there may be
      // no row to mark. Counted as failed and logged; the next sweep retries it
      // because nothing was written.
      console.error("[usage-billing] sweep errored for", shop, err);
      summary.failed += 1;
      continue;
    }

    if (result.status === "sent") summary.sent += 1;
    else if (result.status === "dry_run") summary.dryRun += 1;
    else if (result.status === "skipped") summary.skipped += 1;
    else if (result.status === "failed") summary.failed += 1;
  }

  return summary;
}
