import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import axios from "axios";
import shopify from "../shopify.server.js";
import { upsertOAuthToken } from "../services/oauth.server.js";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await shopify.authenticate.admin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const platform = params.platform!;

  if (!code || !state) throw new Response("Invalid callback", { status: 400 });

  const { brandId } = JSON.parse(Buffer.from(state, "base64url").toString());
  const redirectUri = `${url.protocol}//${url.host}/api/oauth/${platform}/callback`;

  let accessToken: string;
  let refreshToken: string | undefined;
  let expiresAt: Date | undefined;
  let accountId: string;
  let accountName: string | undefined;

  switch (platform) {
    case "twitter": {
      const res = await axios.post(
        "https://api.twitter.com/2/oauth2/token",
        new URLSearchParams({
          code,
          grant_type: "authorization_code",
          client_id: process.env.TWITTER_CLIENT_ID!,
          redirect_uri: redirectUri,
          code_verifier: "challenge",
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`).toString("base64")}`,
          },
        },
      );
      accessToken = res.data.access_token;
      refreshToken = res.data.refresh_token;
      expiresAt = res.data.expires_in ? new Date(Date.now() + res.data.expires_in * 1000) : undefined;
      const me = await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      accountId = me.data.data.id;
      accountName = me.data.data.name;
      break;
    }

    case "instagram_feed":
    case "instagram_reels":
    case "facebook": {
      const res = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: redirectUri,
          code,
        },
      });
      accessToken = res.data.access_token;
      const me = await axios.get("https://graph.facebook.com/v19.0/me", {
        params: { access_token: accessToken, fields: "id,name" },
      });
      accountId = me.data.id;
      accountName = me.data.name;
      break;
    }

    case "linkedin": {
      const res = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      accessToken = res.data.access_token;
      refreshToken = res.data.refresh_token;
      expiresAt = res.data.expires_in ? new Date(Date.now() + res.data.expires_in * 1000) : undefined;
      const me = await axios.get("https://api.linkedin.com/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      accountId = me.data.id;
      accountName = `${me.data.localizedFirstName} ${me.data.localizedLastName}`;
      break;
    }

    case "youtube_shorts": {
      const res = await axios.post("https://oauth2.googleapis.com/token", {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      accessToken = res.data.access_token;
      refreshToken = res.data.refresh_token;
      expiresAt = res.data.expires_in ? new Date(Date.now() + res.data.expires_in * 1000) : undefined;
      const me = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
        params: { part: "snippet", mine: true, access_token: accessToken },
      });
      accountId = me.data.items[0].id;
      accountName = me.data.items[0].snippet.title;
      break;
    }

    default:
      throw new Response(`Unsupported platform: ${platform}`, { status: 400 });
  }

  await upsertOAuthToken({
    brandId,
    platform,
    accessToken,
    refreshToken,
    expiresAt,
    accountId,
    accountName,
  });

  return redirect("/app/connections");
};
