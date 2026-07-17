import crypto from "crypto";
import { createCookie } from "@remix-run/node";
import { prisma } from "../db.server.js";
import type { SocialAccount } from "@prisma/client";
import { encrypt, decrypt } from "./crypto.server.js";

// A token-free view of a SocialAccount, safe to send to the browser (loaders
// serialize whatever they return, so the encrypted token columns must never
// leak into a client payload). Used by the wizard and connections UI.
export interface SocialAccountSummary {
  id: string;
  shop: string;
  platform: string;
  accountId: string;
  accountName: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ACCOUNT_SUMMARY_SELECT = {
  id: true,
  shop: true,
  platform: true,
  accountId: true,
  accountName: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

// A shop-level account plus the brands it is shared with, for the connections
// page. Token columns are deliberately excluded.
export interface SocialAccountWithBrands extends SocialAccountSummary {
  brands: { id: string; name: string }[];
}

/**
 * Create or update a shop-level social account, encrypting its tokens at rest.
 * Keyed by (shop, platform, accountId) so reconnecting the same physical account
 * refreshes its credentials in place. Returns the stored (still-encrypted) row.
 */
export async function upsertSocialAccount(data: {
  shop: string;
  platform: string;
  accountId: string;
  accountName?: string;
  accessToken: string;
  refreshToken?: string;
  tokenSecret?: string;
  expiresAt?: Date;
}): Promise<SocialAccount> {
  const accessToken = encrypt(data.accessToken);
  // undefined leaves the existing column untouched on update (Prisma semantics),
  // matching the previous upsertOAuthToken behaviour.
  const refreshToken = data.refreshToken ? encrypt(data.refreshToken) : undefined;
  const tokenSecret = data.tokenSecret ? encrypt(data.tokenSecret) : undefined;

  return prisma.socialAccount.upsert({
    where: {
      shop_platform_accountId: {
        shop: data.shop,
        platform: data.platform,
        accountId: data.accountId,
      },
    },
    update: {
      accessToken,
      refreshToken,
      tokenSecret,
      expiresAt: data.expiresAt,
      accountName: data.accountName,
    },
    create: {
      shop: data.shop,
      platform: data.platform,
      accountId: data.accountId,
      accountName: data.accountName,
      accessToken,
      refreshToken,
      tokenSecret,
      expiresAt: data.expiresAt,
    },
  });
}

/**
 * Share an account with a brand. Idempotent: re-associating an already-linked
 * account is a no-op rather than an error.
 */
export async function associateAccountWithBrand(
  socialAccountId: string,
  brandId: string,
) {
  return prisma.brandSocialAccount.upsert({
    where: { brandId_socialAccountId: { brandId, socialAccountId } },
    update: {},
    create: { brandId, socialAccountId },
  });
}

/**
 * Stop sharing an account with a brand. The account itself and its post history
 * are left intact; only the brand link is removed.
 */
export async function disassociateFromBrand(
  socialAccountId: string,
  brandId: string,
) {
  return prisma.brandSocialAccount.deleteMany({
    where: { brandId, socialAccountId },
  });
}

/**
 * Accounts a brand can publish to, without tokens. Ordered for stable UI.
 */
export async function getAccountsForBrand(
  brandId: string,
): Promise<SocialAccountSummary[]> {
  const links = await prisma.brandSocialAccount.findMany({
    where: { brandId },
    select: { socialAccount: { select: ACCOUNT_SUMMARY_SELECT } },
    orderBy: { socialAccount: { platform: "asc" } },
  });
  return links.map((l) => l.socialAccount);
}

/**
 * Every account connected for a shop, each with the brands it is shared with.
 * Tokens are excluded so this is safe to return from a loader.
 */
export async function getAccountsForShop(
  shop: string,
): Promise<SocialAccountWithBrands[]> {
  const accounts = await prisma.socialAccount.findMany({
    where: { shop },
    select: {
      ...ACCOUNT_SUMMARY_SELECT,
      brandLinks: {
        select: { brand: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ platform: "asc" }, { accountName: "asc" }],
  });
  return accounts.map(({ brandLinks, ...a }) => ({
    ...a,
    brands: brandLinks.map((bl) => bl.brand),
  }));
}

/**
 * Fetch a single account by id with its tokens decrypted, for publishing and
 * token refresh. Returns null if it does not exist.
 */
export async function getSocialAccount(
  id: string,
): Promise<SocialAccount | null> {
  const account = await prisma.socialAccount.findUnique({ where: { id } });
  if (!account) return null;
  return {
    ...account,
    accessToken: decrypt(account.accessToken),
    refreshToken: account.refreshToken ? decrypt(account.refreshToken) : null,
    tokenSecret: account.tokenSecret ? decrypt(account.tokenSecret) : null,
  };
}

/**
 * Disconnect an account. Scoped to the shop so a merchant can never delete
 * another shop's account. PostPlatform.socialAccountId is set null on delete
 * (SetNull), so post history is preserved.
 */
export async function deleteSocialAccount(id: string, shop: string) {
  return prisma.socialAccount.deleteMany({ where: { id, shop } });
}

/**
 * Platforms a brand has at least one connected account for. Derived from the
 * join; manual platforms (no account) are intentionally not included.
 */
export async function getConnectedPlatforms(brandId: string): Promise<string[]> {
  const accounts = await getAccountsForBrand(brandId);
  return [...new Set(accounts.map((a) => a.platform))];
}

// --- OAuth flow start (PKCE + CSRF state) ---

export interface OAuthState {
  brandId: string;
  nonce: string;
  codeVerifier: string;
}

export interface OAuthFlowStart {
  url: string;
  state: OAuthState;
}

// Short-lived signed cookie holding the flow's brandId, CSRF nonce and PKCE
// verifier. Signed with the Shopify API secret so it cannot be forged.
export const oauthStateCookie = createCookie("oauth_state", {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 600,
  secrets: [process.env.SHOPIFY_API_SECRET ?? "dev-oauth-secret"],
});

// Meta (Facebook / Instagram) requires a page-selection step after OAuth: the
// long-lived user token is carried to that step in this short-lived signed
// cookie rather than being stored as a final credential. Mirrors the
// oauthStateCookie pattern (signed with the Shopify API secret, httpOnly).
export interface MetaSelectionState {
  brandId: string;
  platform: string;
  userToken: string;
}

export const metaSelectionCookie = createCookie("meta_selection", {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 600,
  secrets: [process.env.SHOPIFY_API_SECRET ?? "dev-oauth-secret"],
});

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

function codeChallengeS256(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

function generateNonce(): string {
  return base64url(crypto.randomBytes(16));
}

export function buildOAuthUrl(
  platform: string,
  brandId: string,
  baseUrl: string,
): OAuthFlowStart {
  const redirectUri = `${baseUrl}/api/oauth/${platform}/callback`;
  const nonce = generateNonce();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = codeChallengeS256(codeVerifier);
  const state = nonce;

  const flow = (url: string): OAuthFlowStart => ({
    url,
    state: { brandId, nonce, codeVerifier },
  });

  switch (platform) {
    case "twitter":
      return flow(
        `https://x.com/i/oauth2/authorize` +
          `?response_type=code` +
          `&client_id=${process.env.TWITTER_CLIENT_ID}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&scope=${encodeURIComponent("tweet.read tweet.write users.read offline.access media.write")}` +
          `&state=${state}` +
          `&code_challenge=${codeChallenge}` +
          `&code_challenge_method=S256`,
      );

    case "instagram_feed":
    case "instagram_reels":
    case "facebook":
      return flow(
        `https://www.facebook.com/v19.0/dialog/oauth` +
          `?client_id=${process.env.META_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&scope=${encodeURIComponent("pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management")}` +
          `&state=${state}` +
          `&response_type=code`,
      );

    case "tiktok":
      return flow(
        `https://www.tiktok.com/v2/auth/authorize` +
          `?client_key=${process.env.TIKTOK_CLIENT_KEY}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&scope=${encodeURIComponent("video.upload,video.publish")}` +
          `&state=${state}` +
          `&response_type=code` +
          `&code_challenge=${codeChallenge}` +
          `&code_challenge_method=S256`,
      );

    case "linkedin":
      return flow(
        `https://www.linkedin.com/oauth/v2/authorization` +
          `?response_type=code` +
          `&client_id=${process.env.LINKEDIN_CLIENT_ID}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&scope=${encodeURIComponent("openid profile w_member_social")}` +
          `&state=${state}`,
      );

    case "youtube_shorts":
      return flow(
        `https://accounts.google.com/o/oauth2/v2/auth` +
          `?response_type=code` +
          `&client_id=${process.env.GOOGLE_CLIENT_ID}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&scope=${encodeURIComponent("https://www.googleapis.com/auth/youtube.upload")}` +
          `&state=${state}` +
          `&access_type=offline` +
          `&prompt=consent`,
      );

    case "rednote":
      throw new Error("RedNote uses API key authentication, not OAuth.");

    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}
