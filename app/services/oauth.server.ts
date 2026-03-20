import { prisma } from "../db.server.js";
import type { OAuthToken } from "@prisma/client";

export async function getOAuthToken(
  brandId: string,
  platform: string,
): Promise<OAuthToken | null> {
  return prisma.oAuthToken.findUnique({
    where: { brandId_platform: { brandId, platform } },
  });
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
  return prisma.oAuthToken.upsert({
    where: { brandId_platform: { brandId: data.brandId, platform: data.platform } },
    update: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tokenSecret: data.tokenSecret,
      expiresAt: data.expiresAt,
      accountId: data.accountId,
      accountName: data.accountName,
    },
    create: data,
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

export function buildOAuthUrl(
  platform: string,
  brandId: string,
  baseUrl: string,
): string {
  const redirectUri = `${baseUrl}/api/oauth/${platform}/callback`;
  const state = Buffer.from(JSON.stringify({ brandId })).toString("base64url");

  switch (platform) {
    case "twitter":
      return (
        `https://twitter.com/i/oauth2/authorize` +
        `?response_type=code` +
        `&client_id=${process.env.TWITTER_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent("tweet.read tweet.write users.read offline.access media.write")}` +
        `&state=${state}` +
        `&code_challenge=challenge` +
        `&code_challenge_method=plain`
      );

    case "instagram_feed":
    case "instagram_reels":
    case "facebook":
      return (
        `https://www.facebook.com/v19.0/dialog/oauth` +
        `?client_id=${process.env.META_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent("pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish")}` +
        `&state=${state}` +
        `&response_type=code`
      );

    case "tiktok":
      return (
        `https://www.tiktok.com/v2/auth/authorize` +
        `?client_key=${process.env.TIKTOK_CLIENT_KEY}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent("video.upload,video.publish")}` +
        `&state=${state}` +
        `&response_type=code`
      );

    case "linkedin":
      return (
        `https://www.linkedin.com/oauth/v2/authorization` +
        `?response_type=code` +
        `&client_id=${process.env.LINKEDIN_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent("w_member_social r_basicprofile")}` +
        `&state=${state}`
      );

    case "youtube_shorts":
      return (
        `https://accounts.google.com/o/oauth2/v2/auth` +
        `?response_type=code` +
        `&client_id=${process.env.GOOGLE_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent("https://www.googleapis.com/auth/youtube.upload")}` +
        `&state=${state}` +
        `&access_type=offline`
      );

    case "rednote":
      throw new Error("RedNote uses API key authentication, not OAuth.");

    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}
