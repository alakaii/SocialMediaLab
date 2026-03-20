import axios from "axios";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";

const TIKTOK_BASE = "https://open.tiktokapis.com/v2";

export const tiktokAdapter: PlatformAdapter = {
  platform: Platform.TikTok,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accessToken, content, mediaAssets } = payload;

    const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));
    if (!video) throw new Error("TikTok requires a video asset.");

    // Initialize upload
    const initRes = await axios.post(
      `${TIKTOK_BASE}/post/publish/video/init/`,
      {
        post_info: {
          title: content.slice(0, 2200),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: video.url,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      },
    );

    const publishId = initRes.data.data?.publish_id as string;
    if (!publishId) throw new Error("TikTok: no publish_id returned.");

    // Poll for completion
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const statusRes = await axios.post(
        `${TIKTOK_BASE}/post/publish/status/fetch/`,
        { publish_id: publishId },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=UTF-8",
          },
        },
      );
      const status = statusRes.data.data?.status as string;
      if (status === "PUBLISH_COMPLETE") {
        return { platformPostId: publishId };
      }
      if (status === "FAILED") {
        throw new Error("TikTok publishing failed.");
      }
    }

    throw new Error("TikTok publishing timed out.");
  },
};
