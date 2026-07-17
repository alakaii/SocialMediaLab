import axios from "axios";
import type { SocialAccount } from "@prisma/client";
import { getSocialAccount, upsertSocialAccount } from "./oauth.server.js";

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

// Returns a decrypted SocialAccount with a valid access token, refreshing and
// persisting it first when it is close to expiry. Keyed by account id now that
// accounts are shop-level and shared across brands.
export async function getFreshToken(
  socialAccountId: string,
): Promise<SocialAccount> {
  const account = await getSocialAccount(socialAccountId);
  if (!account) {
    throw new Error(`No connected account: ${socialAccountId}`);
  }

  const platform = account.platform;

  const needsRefresh =
    account.expiresAt != null &&
    account.expiresAt.getTime() - Date.now() < REFRESH_WINDOW_MS;

  if (!needsRefresh || !account.refreshToken) {
    return account;
  }

  let refreshed: RefreshResult | null;
  try {
    refreshed = await refreshPlatformToken(platform, account.refreshToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Token refresh failed for ${platform}: ${message}`);
  }

  if (!refreshed) {
    return account;
  }

  const newRefreshToken = refreshed.refreshToken ?? account.refreshToken;
  const newExpiresAt = refreshed.expiresAt ?? account.expiresAt ?? undefined;

  await upsertSocialAccount({
    shop: account.shop,
    platform,
    accountId: account.accountId,
    accountName: account.accountName ?? undefined,
    accessToken: refreshed.accessToken,
    refreshToken: newRefreshToken,
    tokenSecret: account.tokenSecret ?? undefined,
    expiresAt: newExpiresAt,
  });

  return {
    ...account,
    accessToken: refreshed.accessToken,
    refreshToken: newRefreshToken,
    expiresAt: newExpiresAt ?? null,
  };
}
