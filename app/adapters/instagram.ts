import axios from "axios";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

async function createContainer(
  accountId: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<string> {
  const res = await axios.post(
    `${GRAPH_BASE}/${accountId}/media`,
    null,
    { params: { ...params, access_token: accessToken } },
  );
  return res.data.id as string;
}

async function publishContainer(
  accountId: string,
  accessToken: string,
  containerId: string,
): Promise<string> {
  const res = await axios.post(
    `${GRAPH_BASE}/${accountId}/media_publish`,
    null,
    { params: { creation_id: containerId, access_token: accessToken } },
  );
  return res.data.id as string;
}

async function waitForContainer(
  containerId: string,
  accessToken: string,
  maxAttempts = 10,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await axios.get(`${GRAPH_BASE}/${containerId}`, {
      params: { fields: "status_code", access_token: accessToken },
    });
    if (res.data.status_code === "FINISHED") return;
    if (res.data.status_code === "ERROR") {
      throw new Error("Instagram media processing failed");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Instagram media processing timed out");
}

export const instagramFeedAdapter: PlatformAdapter = {
  platform: Platform.InstagramFeed,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accountId, accessToken, content, mediaAssets } = payload;

    let containerId: string;

    if (!mediaAssets.length) {
      // Text-only not supported on Instagram feed; use first image placeholder
      throw new Error("Instagram Feed requires at least one image.");
    }

    if (mediaAssets.length === 1) {
      const asset = mediaAssets[0];
      if (asset.mimeType.startsWith("video/")) {
        containerId = await createContainer(accountId, accessToken, {
          media_type: "VIDEO",
          video_url: asset.url,
          caption: content,
        });
        await waitForContainer(containerId, accessToken);
      } else {
        containerId = await createContainer(accountId, accessToken, {
          image_url: asset.url,
          caption: content,
        });
      }
    } else {
      // Carousel
      const childIds: string[] = [];
      for (const asset of mediaAssets.slice(0, 10)) {
        const childId = await createContainer(accountId, accessToken, {
          image_url: asset.url,
          is_carousel_item: "true",
        });
        childIds.push(childId);
      }
      containerId = await createContainer(accountId, accessToken, {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        caption: content,
      });
    }

    const postId = await publishContainer(accountId, accessToken, containerId);

    return {
      platformPostId: postId,
      url: `https://www.instagram.com/p/${postId}/`,
    };
  },
};

export const instagramReelsAdapter: PlatformAdapter = {
  platform: Platform.InstagramReels,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accountId, accessToken, content, mediaAssets } = payload;

    const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));
    if (!video) throw new Error("Instagram Reels requires a video asset.");

    const containerId = await createContainer(accountId, accessToken, {
      media_type: "REELS",
      video_url: video.url,
      caption: content,
      share_to_feed: "true",
    });

    await waitForContainer(containerId, accessToken);
    const postId = await publishContainer(accountId, accessToken, containerId);

    return {
      platformPostId: postId,
      url: `https://www.instagram.com/reel/${postId}/`,
    };
  },
};
