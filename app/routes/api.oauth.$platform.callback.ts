import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import axios from "axios";
import shopify from "../shopify.server.js";
import { prisma } from "../db.server.js";
import {
  upsertSocialAccount,
  associateAccountWithBrand,
  oauthStateCookie,
  metaSelectionCookie,
} from "../services/oauth.server.js";
import type { OAuthState } from "../services/oauth.server.js";

const META_GRAPH = "https://graph.facebook.com/v21.0";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const platform = params.platform!;

  if (!code || !state) throw new Response("Invalid callback", { status: 400 });

  const stored = (await oauthStateCookie.parse(request.headers.get("Cookie"))) as
    | OAuthState
    | null;
  if (!stored || stored.nonce !== state) {
    throw new Response("Invalid OAuth state", { status: 400 });
  }
  const { brandId, codeVerifier } = stored;

  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.shop !== session.shop) {
    throw new Response("Brand not found", { status: 404 });
  }

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
          code_verifier: codeVerifier,
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
      // 1. Exchange the authorization code for a short-lived user token.
      const shortRes = await axios.get(`${META_GRAPH}/oauth/access_token`, {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: redirectUri,
          code,
        },
      });
      const shortToken = shortRes.data.access_token as string;

      // 2. Immediately exchange it for a long-lived user token. Page access
      //    tokens derived from a long-lived user token do not expire.
      const longRes = await axios.get(`${META_GRAPH}/oauth/access_token`, {
        params: {
          grant_type: "fb_exchange_token",
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          fb_exchange_token: shortToken,
        },
      });
      const longToken = longRes.data.access_token as string;

      // 3. Do NOT store the user token as the final credential. Redirect to the
      //    page-selection step, carrying the long-lived user token (plus brand
      //    and platform) in a short-lived signed httpOnly cookie.
      const headers = new Headers();
      headers.append("Set-Cookie", await oauthStateCookie.serialize("", { maxAge: 0 }));
      headers.append(
        "Set-Cookie",
        await metaSelectionCookie.serialize({ brandId, platform, userToken: longToken }),
      );
      return redirect("/app/connections/meta", { headers });
    }

    case "tiktok": {
      const res = await axios.post(
        "https://open.tiktokapis.com/v2/oauth/token/",
        new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY!,
          client_secret: process.env.TIKTOK_CLIENT_SECRET!,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      accessToken = res.data.access_token;
      refreshToken = res.data.refresh_token;
      expiresAt = res.data.expires_in ? new Date(Date.now() + res.data.expires_in * 1000) : undefined;
      const me = await axios.get("https://open.tiktokapis.com/v2/user/info/", {
        params: { fields: "open_id,display_name" },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      accountId = me.data.data.user.open_id;
      accountName = me.data.data.user.display_name;
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
      const me = await axios.get("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      accountId = me.data.sub;
      accountName = me.data.name;
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

  // Store the credential at the shop level, then associate it with the brand the
  // merchant started the flow from (brandId came from the signed state cookie and
  // was verified to belong to this shop above).
  const account = await upsertSocialAccount({
    shop: session.shop,
    platform,
    accountId,
    accountName,
    accessToken,
    refreshToken,
    expiresAt,
  });
  await associateAccountWithBrand(account.id, brandId);

  return redirect("/app/connections", {
    headers: {
      "Set-Cookie": await oauthStateCookie.serialize("", { maxAge: 0 }),
    },
  });
};
