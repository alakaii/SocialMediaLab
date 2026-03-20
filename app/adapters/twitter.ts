import { TwitterApi } from "twitter-api-v2";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";

export const twitterAdapter: PlatformAdapter = {
  platform: Platform.Twitter,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const client = new TwitterApi(payload.accessToken);

    const mediaIds: string[] = [];
    for (const asset of payload.mediaAssets.slice(0, 4)) {
      if (asset.mimeType.startsWith("image/")) {
        const response = await fetch(asset.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        const mediaId = await client.v1.uploadMedia(buffer, {
          mimeType: asset.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        });
        mediaIds.push(mediaId);
      }
    }

    const tweetData: { text: string; media?: { media_ids: [string, ...string[]] } } = {
      text: payload.content,
    };
    if (mediaIds.length > 0) {
      tweetData.media = { media_ids: mediaIds as [string, ...string[]] };
    }

    const tweet = await client.v2.tweet(tweetData);

    return {
      platformPostId: tweet.data.id,
      url: `https://twitter.com/i/web/status/${tweet.data.id}`,
    };
  },

  async refreshAccessToken(refreshToken: string) {
    const client = new TwitterApi({
      clientId: process.env.TWITTER_CLIENT_ID!,
      clientSecret: process.env.TWITTER_CLIENT_SECRET!,
    });
    const result = await client.refreshOAuth2Token(refreshToken);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresIn
        ? new Date(Date.now() + result.expiresIn * 1000)
        : undefined,
    };
  },
};
