import crypto from "crypto";
import { createCookie } from "@remix-run/node";
import { prisma } from "../db.server.js";
import type { OAuthToken } from "@prisma/client";
import { encrypt, decrypt } from "./crypto.server.js";

export async function getOAuthToken(
  brandId: string,
  platform: string,
): Promise<OAuthToken | null> {
  const token = await prisma.oAuthToken.findUnique({
    where: { brandId_platform: { brandId, platform } },
  });
  if (!token) return null;
  return {
    ...token,
    accessToken: decrypt(token.accessToken),
    refreshToken: token.refreshToken ? decrypt(token.refreshToken) : null,
    tokenSecret: token.tokenSecret ? decrypt(token.tokenSecret) : null,
  };
}

export async function upsertOAuthToken(data: {
  brandId: string;
  platform: string;
  accessToken: string;
  refreshToken?: string;
  tokenSecret?: string;
  expiresAt?: Date;
  accountId: string;
  accountName?: string;
}) {
  const accessToken = encrypt(data.accessToken);
  const refreshToken = data.refreshToken ? encrypt(data.refreshToken) : undefined;
  const tokenSecret = data.tokenSecret ? encrypt(data.tokenSecret) : undefined;

  return prisma.oAuthToken.upsert({
    where: { brandId_platform: { brandId: data.brandId, platform: data.platform } },
    update: {
      accessToken,
      refreshToken,
      tokenSecret,
      expiresAt: data.expiresAt,
      accountId: data.accountId,
      accountName: data.accountName,
    },
    create: {
      brandId: data.brandId,
      platform: data.platform,
      accessToken,
      refreshToken,
      tokenSecret,
      expiresAt: data.expiresAt,
      accountId: data.accountId,
      accountName: data.accountName,
    },
  });
}

export async function deleteOAuthToken(brandId: string, platform: string) {
  return prisma.oAuthToken.deleteMany({
    where: { brandId, platform },
  });
}

export async function getConnectedPlatforms(brandId: string): Promise<string[]> {
  const tokens = await prisma.oAuthToken.findMany({
    where: { brandId },
    select: { platform: true },
  });
  return tokens.map((t) => t.platform);
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
          `&scope=${encodeURIComponent("pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish")}` +
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
