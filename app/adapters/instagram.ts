import axios from "axios";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";
import { GRAPH_BASE, metaGraphError } from "./metaGraph.js";

// Instagram publishing (Graph API content publishing).
//
// The connect flow stores, for instagram_feed / instagram_reels:
//   accountId    = Instagram business account id (the IG user id)
//   accessToken  = Page access token (non-expiring)
//   tokenSecret  = Facebook Page id (not used at publish time)
//
// Publishing is a two-step container flow: create a media container, wait for
// Instagram to finish processing it, then publish the container.

async function createContainer(
  igUserId: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<string> {
  const res = await axios.post(`${GRAPH_BASE}/${igUserId}/media`, null, {
    params: { ...params, access_token: accessToken },
  });
  return res.data.id as string;
}

async function publishContainer(
  igUserId: string,
  accessToken: string,
  creationId: string,
): Promise<string> {
  const res = await axios.post(`${GRAPH_BASE}/${igUserId}/media_publish`, null, {
    params: { creation_id: creationId, access_token: accessToken },
  });
  return res.data.id as string;
}

// Polls the container status roughly once per second until it reports FINISHED.
// Fails fast on ERROR and after timeoutMs, surfacing the reported status.
async function waitForContainer(
  containerId: string,
  accessToken: string,
  timeoutMs: number,
): Promise<void> {
  const intervalMs = 1000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const res = await axios.get(`${GRAPH_BASE}/${containerId}`, {
      params: { fields: "status_code,status", access_token: accessToken },
    });
    const code = res.data.status_code as string;
    lastStatus = (res.data.status as string) || code || "";

    if (code === "FINISHED") return;
    if (code === "ERROR") {
      throw new Error(`Instagram media processing failed: ${lastStatus}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Instagram media processing timed out (last status: ${lastStatus || "unknown"}).`,
  );
}

const FEED_TIMEOUT_MS = 60_000; // ~1 minute for photos.
const REELS_TIMEOUT_MS = 300_000; // ~5 minutes for video processing.

export const instagramFeedAdapter: PlatformAdapter = {
  platform: Platform.InstagramFeed,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accountId, accessToken, content, mediaAssets } = payload;

    if (!mediaAssets.length) {
      throw new Error("Instagram Feed requires at least one image.");
    }

    try {
      let containerId: string;

      if (mediaAssets.length === 1) {
        const asset = mediaAssets[0];
        if (asset.mimeType.startsWith("video/")) {
          containerId = await createContainer(accountId, accessToken, {
            media_type: "VIDEO",
            video_url: asset.url,
            caption: content,
          });
          await waitForContainer(containerId, accessToken, REELS_TIMEOUT_MS);
        } else {
          containerId = await createContainer(accountId, accessToken, {
            image_url: asset.url,
            caption: content,
          });
          await waitForContainer(containerId, accessToken, FEED_TIMEOUT_MS);
        }
      } else {
        // Carousel: create an item container per image, then a parent container.
        const childIds: string[] = [];
        for (const asset of mediaAssets.slice(0, 10)) {
          const childId = await createContainer(accountId, accessToken, {
            image_url: asset.url,
            is_carousel_item: "true",
          });
          await waitForContainer(childId, accessToken, FEED_TIMEOUT_MS);
          childIds.push(childId);
        }
        containerId = await createContainer(accountId, accessToken, {
          media_type: "CAROUSEL",
          children: childIds.join(","),
          caption: content,
        });
        await waitForContainer(containerId, accessToken, FEED_TIMEOUT_MS);
      }

      const postId = await publishContainer(accountId, accessToken, containerId);

      return {
        platformPostId: postId,
        url: `https://www.instagram.com/p/${postId}/`,
      };
    } catch (err) {
      throw metaGraphError(err, "Instagram Feed publish failed");
    }
  },
};

export const instagramReelsAdapter: PlatformAdapter = {
  platform: Platform.InstagramReels,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accountId, accessToken, content, mediaAssets } = payload;

    const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));
    if (!video) throw new Error("Instagram Reels requires a video asset.");

    try {
      const containerId = await createContainer(accountId, accessToken, {
        media_type: "REELS",
        video_url: video.url,
        caption: content,
        share_to_feed: "true",
      });

      await waitForContainer(containerId, accessToken, REELS_TIMEOUT_MS);
      const postId = await publishContainer(accountId, accessToken, containerId);

      return {
        platformPostId: postId,
        url: `https://www.instagram.com/reel/${postId}/`,
      };
    } catch (err) {
      throw metaGraphError(err, "Instagram Reels publish failed");
    }
  },
};
