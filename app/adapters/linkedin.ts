import axios from "axios";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";

const LI_BASE = "https://api.linkedin.com/v2";

export const linkedinAdapter: PlatformAdapter = {
  platform: Platform.LinkedIn,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accessToken, accountId, content, mediaAssets, extra } = payload;

    const authorUrn = `urn:li:person:${accountId}`;

    const postBody: Record<string, unknown> = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    if (mediaAssets.length > 0) {
      const images = mediaAssets.filter((a) => a.mimeType.startsWith("image/"));
      const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));

      if (video) {
        const specificContent = postBody.specificContent as Record<string, Record<string, unknown>>;
        specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory = "VIDEO";
        specificContent["com.linkedin.ugc.ShareContent"].media = [
          {
            status: "READY",
            originalUrl: video.url,
            title: { text: extra?.title ?? "Video" },
          },
        ];
      } else if (images.length > 0) {
        const specificContent = postBody.specificContent as Record<string, Record<string, unknown>>;
        specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory = "IMAGE";
        specificContent["com.linkedin.ugc.ShareContent"].media = images.slice(0, 9).map((img) => ({
          status: "READY",
          originalUrl: img.url,
          description: { text: img.mimeType },
          title: { text: "Image" },
        }));
      }
    }

    const res = await axios.post(`${LI_BASE}/ugcPosts`, postBody, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });

    const postId = (res.headers["x-restli-id"] as string) ?? res.data.id;

    return {
      platformPostId: postId,
      url: `https://www.linkedin.com/feed/update/${postId}/`,
    };
  },
};
