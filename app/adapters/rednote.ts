import axios from "axios";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";

// RedNote (Xiaohongshu) uses a third-party API or browser automation.
// This adapter targets the unofficial/partner API when available,
// falling back to a webhook-based approach for manual queuing.
const REDNOTE_BASE = "https://edith.xiaohongshu.com";

export const redNoteAdapter: PlatformAdapter = {
  platform: Platform.RedNote,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accessToken, content, mediaAssets, extra } = payload;

    const images = mediaAssets.filter((a) => a.mimeType.startsWith("image/"));

    const noteData: Record<string, unknown> = {
      title: (extra?.title as string | undefined) ?? content.slice(0, 20),
      desc: content,
      type: images.length > 0 ? "normal" : "video",
      privacy_type: "public",
      tags: extra?.tags ?? [],
    };

    if (images.length > 0) {
      noteData.images = images.map((img) => ({ url: img.url }));
    }

    const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));
    if (video) {
      noteData.video = { url: video.url };
    }

    const res = await axios.post(`${REDNOTE_BASE}/api/sns/web/v1/note/create`, noteData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "x-s": "", // RedNote requires request signing — implement HMAC here
        "x-t": Date.now().toString(),
      },
    });

    const noteId = res.data?.data?.note_id as string | undefined;
    if (!noteId) throw new Error("RedNote: no note_id returned.");

    return {
      platformPostId: noteId,
      url: `https://www.xiaohongshu.com/explore/${noteId}`,
    };
  },
};
