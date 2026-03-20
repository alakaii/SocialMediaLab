import axios from "axios";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

export const facebookAdapter: PlatformAdapter = {
  platform: Platform.Facebook,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accountId, accessToken, content, mediaAssets } = payload;

    if (!mediaAssets.length) {
      // Text-only post
      const res = await axios.post(`${GRAPH_BASE}/${accountId}/feed`, null, {
        params: { message: content, access_token: accessToken },
      });
      return { platformPostId: res.data.id };
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
      return { platformPostId: res.data.id };
    }

    if (images.length === 1) {
      const res = await axios.post(`${GRAPH_BASE}/${accountId}/photos`, null, {
        params: {
          url: images[0].url,
          caption: content,
          access_token: accessToken,
        },
      });
      return { platformPostId: res.data.id };
    }

    // Multi-photo album
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

    return { platformPostId: res.data.id };
  },
};
