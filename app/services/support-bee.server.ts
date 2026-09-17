/**
 * Support Bee customer token minting. Copy this file into a source app as
 * `app/utils/support-bee.server.ts` (or wherever server-only code lives) and
 * keep it in step with `app/services/source-token.server.ts` in Support Bee.
 *
 * Node only (uses node:crypto). Never import it from browser code: the secret
 * must not leave the server.
 */
import { createHmac } from "node:crypto";

export interface SupportBeeClaims {
  /** The customer's stable id in your app: a myshopify domain, a user id. */
  sub: string;
  name?: string;
  email?: string;
  /** Shown to the admin next to the conversation: plan, app version, locale. */
  meta?: Record<string, string>;
}

export interface SupportBeeWidgetConfig {
  url: string;
  source: string;
  token: string;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function mintSupportBeeToken(
  secret: string,
  claims: SupportBeeClaims,
  ttlSeconds = 12 * 60 * 60,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { ...claims, iat: now, exp: now + ttlSeconds };
  const signingInput = `sb1.${b64url(JSON.stringify(payload))}`;
  const mac = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${b64url(mac)}`;
}

/**
 * Everything the widget needs, or null when Support Bee is not configured for
 * this deployment (the three env vars are unset), so the caller renders no
 * bubble rather than a broken one.
 */
export function supportBeeWidgetConfig(
  claims: SupportBeeClaims,
  vars: Record<string, string | undefined> = process.env,
): SupportBeeWidgetConfig | null {
  const url = vars.SUPPORT_BEE_URL?.replace(/\/+$/, "");
  const source = vars.SUPPORT_BEE_SOURCE;
  const secret = vars.SUPPORT_BEE_SECRET;
  if (!url || !source || !secret) return null;
  return { url, source, token: mintSupportBeeToken(secret, claims) };
}
