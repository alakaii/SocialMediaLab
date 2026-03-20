export enum PostType {
  Text = "text",
  Image = "image",
  ShortsVideo = "shorts_video",
  Video = "video",
}

export enum PostStatus {
  Draft = "draft",
  Scheduled = "scheduled",
  Publishing = "publishing",
  Published = "published",
  Failed = "failed",
  Cancelled = "cancelled",
}

export enum PlatformPostStatus {
  Pending = "pending",
  Published = "published",
  Failed = "failed",
  Skipped = "skipped",
}

export enum Platform {
  Twitter = "twitter",
  InstagramFeed = "instagram_feed",
  InstagramReels = "instagram_reels",
  TikTok = "tiktok",
  Facebook = "facebook",
  LinkedIn = "linkedin",
  RedNote = "rednote",
  YouTubeShorts = "youtube_shorts",
}

export interface WizardState {
  scheduledAt: string | null; // ISO string
  brandId: string | null;
  postType: PostType | null;
  platforms: Platform[];
  mainContent: string;
  mediaAssets: WizardMediaAsset[];
  platformOverrides: Partial<Record<Platform, PlatformOverride>>;
}

export interface WizardMediaAsset {
  id: string;
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  altText?: string;
}

export interface PlatformOverride {
  content?: string;
  extra?: Record<string, unknown>;
}

export const EMPTY_WIZARD_STATE: WizardState = {
  scheduledAt: null,
  brandId: null,
  postType: null,
  platforms: [],
  mainContent: "",
  mediaAssets: [],
  platformOverrides: {},
};
