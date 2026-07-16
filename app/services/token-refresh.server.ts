import axios from "axios";
import type { OAuthToken } from "@prisma/client";
import { getOAuthToken, upsertOAuthToken } from "./oauth.server.js";

// Refresh when the stored token expires within this window (or has already expired).
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

async function refreshPlatformToken(
  platform: string,
  refreshToken: string,
): Promise<RefreshResult | null> {
  switch (platform) {
    case "twitter": {
      const res = await axios.post(
        "https://api.twitter.com/2/oauth2/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString("base64")}`,
          },
        },
      );
      return {
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token,
        expiresAt: res.data.expires_in
          ? new Date(Date.now() + res.data.expires_in * 1000)
          : undefined,
      };
    }

    case "youtube_shorts": {
      const res = await axios.post("https://oauth2.googleapis.com/token", {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      return {
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token,
        expiresAt: res.data.expires_in
          ? new Date(Date.now() + res.data.expires_in * 1000)
          : undefined,
      };
    }

    default:
      // Platforms without a short-lived-token refresh flow use the stored token.
      return null;
  }
}

// Returns a decrypted OAuthToken with a valid access token, refreshing and
// persisting it first when it is close to expiry.
export async function getFreshToken(
  brandId: string,
  platform: string,
): Promise<OAuthToken> {
  const token = await getOAuthToken(brandId, platform);
  if (!token) {
    throw new Error(`No OAuth token for platform: ${platform}`);
  }

  const needsRefresh =
    token.expiresAt != null &&
    token.expiresAt.getTime() - Date.now() < REFRESH_WINDOW_MS;

  if (!needsRefresh || !token.refreshToken) {
    return token;
  }

  let refreshed: RefreshResult | null;
  try {
    refreshed = await refreshPlatformToken(platform, token.refreshToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Token refresh failed for ${platform}: ${message}`);
  }

  if (!refreshed) {
    return token;
  }

  const newRefreshToken = refreshed.refreshToken ?? token.refreshToken;
  const newExpiresAt = refreshed.expiresAt ?? token.expiresAt ?? undefined;

  await upsertOAuthToken({
    brandId,
    platform,
    accessToken: refreshed.accessToken,
    refreshToken: newRefreshToken,
    tokenSecret: token.tokenSecret ?? undefined,
    expiresAt: newExpiresAt,
    accountId: token.accountId,
    accountName: token.accountName ?? undefined,
  });

  return {
    ...token,
    accessToken: refreshed.accessToken,
    refreshToken: newRefreshToken,
    expiresAt: newExpiresAt ?? null,
  };
}
