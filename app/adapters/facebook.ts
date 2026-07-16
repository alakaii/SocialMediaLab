import axios from "axios";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";
import { GRAPH_BASE, metaGraphError } from "./metaGraph.js";

// Facebook Pages publishing.
//
// The connect flow stores, for the facebook platform:
//   accountId    = Page id
//   accessToken  = Page access token (non-expiring, from a long-lived user token)
export const facebookAdapter: PlatformAdapter = {
  platform: Platform.Facebook,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accountId, accessToken, content, mediaAssets } = payload;

    try {
      if (!mediaAssets.length) {
        // Text-only post.
        const res = await axios.post(`${GRAPH_BASE}/${accountId}/feed`, null, {
          params: { message: content, access_token: accessToken },
        });
        return { platformPostId: res.data.id as string };
      }

      const images = mediaAssets.filter((a) => a.mimeType.startsWith("image/"));
      const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));

      if (video) {
        const res = await axios.post(`${GRAPH_BASE}/${accountId}/videos`, null, {
          params: {
            file_url: video.url,
            description: content,
            access_token: accessToken,
          },
        });
        return { platformPostId: res.data.id as string };
      }

      if (images.length === 1) {
        // Single image: publish directly with a caption.
        const res = await axios.post(`${GRAPH_BASE}/${accountId}/photos`, null, {
          params: {
            url: images[0].url,
            caption: content,
            access_token: accessToken,
          },
        });
        return { platformPostId: res.data.id as string };
      }

      // Multiple images: upload each unpublished, then attach them to a feed post.
      const photoIds: string[] = [];
      for (const img of images.slice(0, 30)) {
        const res = await axios.post(`${GRAPH_BASE}/${accountId}/photos`, null, {
          params: {
            url: img.url,
            published: "false",
            access_token: accessToken,
          },
        });
        photoIds.push(res.data.id as string);
      }

      const res = await axios.post(`${GRAPH_BASE}/${accountId}/feed`, null, {
        params: {
          message: content,
          attached_media: JSON.stringify(photoIds.map((id) => ({ media_fbid: id }))),
          access_token: accessToken,
        },
      });

      return { platformPostId: res.data.id as string };
    } catch (err) {
      throw metaGraphError(err, "Facebook publish failed");
    }
  },
};
