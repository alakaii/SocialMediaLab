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
  // Manual platforms (e.g. RedNote) have no posting API. At publish time the
  // worker preps the content and parks the platform here until the merchant
  // copy-pastes into the app and confirms. Non-terminal: the parent post stays
  // in "publishing" while any platform sits in this state.
  AwaitingManual = "awaiting_manual",
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
  Bluesky = "bluesky",
}

export interface WizardState {
  scheduledAt: string | null; // ISO string
  brandId: string | null;
  postType: PostType | null;
  // Shop-level accounts (by id) this post publishes to. A post may target two
  // accounts on the same platform (e.g. two Facebook pages).
  selectedAccountIds: string[];
  // Manual platforms (e.g. rednote) selected for this post. These have no
  // connected account, so they are tracked by platform key rather than account.
  manualPlatforms: Platform[];
  mainContent: string;
  mediaAssets: WizardMediaAsset[];
  // Per-platform content/settings overrides, keyed by platform. An override
  // applies to every row of that platform (all accounts share the override).
  platformOverrides: Partial<Record<Platform, PlatformOverride>>;
  product: LinkedProduct | null;
}

export interface LinkedProduct {
  id: string; // Shopify product GID, e.g. gid://shopify/Product/123
  handle: string;
  title: string;
  url: string; // https://<shop-domain>/products/<handle>
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
  selectedAccountIds: [],
  manualPlatforms: [],
  mainContent: "",
  mediaAssets: [],
  platformOverrides: {},
  product: null,
};

/**
 * Post statuses a merchant is allowed to edit or publish-now. A draft has not
 * been scheduled yet; a scheduled post has queued jobs we can still cancel and
 * recompute. Once a post starts publishing (publishing/published/failed) or is
 * cancelled, its content and platform set are frozen.
 *
 * Lives here (client-safe) rather than in post.server.ts so route components can
 * decide whether to show Edit / Publish-now affordances without pulling the
 * server-only service (prisma, queue) into the browser bundle. post.server.ts
 * re-exports these for server-side use so there is a single source of truth.
 */
export const EDITABLE_POST_STATUSES: string[] = [
  PostStatus.Draft,
  PostStatus.Scheduled,
];

export function isPostEditable(status: string): boolean {
  return EDITABLE_POST_STATUSES.includes(status);
}
