import type { Platform } from "../types/post.js";

export interface MediaAssetPayload {
  url: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
}

export interface PublishPayload {
  content: string;
  mediaAssets: MediaAssetPayload[];
  extra: Record<string, unknown>;
  accessToken: string;
  refreshToken?: string;
  tokenSecret?: string;
  accountId: string;
}

export interface PublishResult {
  platformPostId: string;
  url?: string;
}

export interface PlatformAdapter {
  platform: Platform;
  publish(payload: PublishPayload): Promise<PublishResult>;
  refreshAccessToken?(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }>;
}
