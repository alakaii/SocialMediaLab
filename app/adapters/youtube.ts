import axios from "axios";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";

const YT_UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";
const YT_BASE = "https://www.googleapis.com/youtube/v3";

export const youtubeShortsAdapter: PlatformAdapter = {
  platform: Platform.YouTubeShorts,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accessToken, content, mediaAssets, extra } = payload;

    const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));
    if (!video) throw new Error("YouTube Shorts requires a video asset.");

    const title = String(extra?.title ?? content.slice(0, 100));
    const description = content;
    const tags = (extra?.tags as string[] | undefined) ?? [];

    // Insert the video metadata
    const metaRes = await axios.post(
      `${YT_BASE}/videos`,
      {
        snippet: { title, description, tags, categoryId: "22" },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      },
      {
        params: { part: "snippet,status", uploadType: "resumable" },
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    // Initiate resumable upload
    const uploadRes = await axios.post(YT_UPLOAD, null, {
      params: {
        uploadType: "resumable",
        part: "snippet,status",
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": video.mimeType,
      },
      data: {
        snippet: { title, description, tags },
        status: { privacyStatus: "public" },
      },
    });

    const uploadUrl = uploadRes.headers["location"] as string;

    // Stream the video from its URL to YouTube
    const videoRes = await axios.get(video.url, { responseType: "stream" });

    await axios.put(uploadUrl, videoRes.data, {
      headers: {
        "Content-Type": video.mimeType,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const videoId = metaRes.data.id as string;

    return {
      platformPostId: videoId,
      url: `https://youtube.com/shorts/${videoId}`,
    };
  },

  async refreshAccessToken(refreshToken: string) {
    const res = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    return {
      accessToken: res.data.access_token as string,
      expiresAt: new Date(Date.now() + (res.data.expires_in as number) * 1000),
    };
  },
};
