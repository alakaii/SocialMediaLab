import { Platform, PostType } from "../types/post.js";

export interface PlatformConstraints {
  label: string;
  icon: string;
  maxChars: number | null;
  maxHashtags?: number;
  maxImages?: number;
  maxVideos?: number;
  supportedPostTypes: PostType[];
  aspectRatios?: string[];
  videoMaxSec?: number;
  titleMaxChars?: number;
  hashtagStyle?: "inline" | "block" | "note";
  supportsAlbums?: boolean;
  supportsLinkPreview?: boolean;
  supportsPdf?: boolean;
  note?: string;
}

export const PLATFORM_CONSTRAINTS: Record<Platform, PlatformConstraints> = {
  [Platform.Twitter]: {
    label: "Twitter / X",
    icon: "𝕏",
    maxChars: 280,
    maxImages: 4,
    maxVideos: 1,
    supportedPostTypes: [PostType.Text, PostType.Image, PostType.Video],
    hashtagStyle: "inline",
    videoMaxSec: 140,
    note: "URLs count as 23 characters each.",
  },
  [Platform.InstagramFeed]: {
    label: "Instagram Feed",
    icon: "📷",
    maxChars: 2200,
    maxHashtags: 30,
    maxImages: 10,
    supportedPostTypes: [PostType.Text, PostType.Image],
    aspectRatios: ["1:1", "4:5", "1.91:1"],
    hashtagStyle: "block",
    note: "Place hashtags in the first comment to keep captions clean.",
  },
  [Platform.InstagramReels]: {
    label: "Instagram Reels",
    icon: "🎬",
    maxChars: 2200,
    maxHashtags: 30,
    supportedPostTypes: [PostType.ShortsVideo],
    aspectRatios: ["9:16"],
    videoMaxSec: 90,
    hashtagStyle: "block",
  },
  [Platform.TikTok]: {
    label: "TikTok",
    icon: "🎵",
    maxChars: 2200,
    supportedPostTypes: [PostType.ShortsVideo, PostType.Video],
    aspectRatios: ["9:16"],
    videoMaxSec: 600,
    hashtagStyle: "block",
    note: "Native sounds and effects must be added in-app.",
  },
  [Platform.Facebook]: {
    label: "Facebook",
    icon: "👥",
    maxChars: null,
    maxImages: 30,
    supportedPostTypes: [PostType.Text, PostType.Image, PostType.Video],
    supportsAlbums: true,
    supportsLinkPreview: true,
    note: "Longer posts perform well with storytelling content.",
  },
  [Platform.LinkedIn]: {
    label: "LinkedIn",
    icon: "💼",
    maxChars: 3000,
    supportedPostTypes: [PostType.Text, PostType.Image, PostType.Video],
    supportsPdf: true,
    hashtagStyle: "block",
    note: "Professional tone performs best. PDF carousels get high engagement.",
  },
  [Platform.RedNote]: {
    label: "RedNote (小红书)",
    icon: "📕",
    maxChars: 1000,
    maxHashtags: 20,
    supportedPostTypes: [PostType.Text, PostType.Image],
    hashtagStyle: "note",
    aspectRatios: ["3:4", "1:1"],
    note: "Use note-style storytelling with lifestyle context. Chinese content preferred.",
  },
  [Platform.YouTubeShorts]: {
    label: "YouTube Shorts",
    icon: "▶️",
    maxChars: 5000,
    titleMaxChars: 100,
    supportedPostTypes: [PostType.ShortsVideo],
    aspectRatios: ["9:16"],
    videoMaxSec: 60,
    note: "Title is the most important field for discoverability.",
  },
};

export function getPlatformsForPostType(postType: PostType): Platform[] {
  return Object.entries(PLATFORM_CONSTRAINTS)
    .filter(([, c]) => c.supportedPostTypes.includes(postType))
    .map(([p]) => p as Platform);
}

export function isContentValid(
  platform: Platform,
  content: string,
  extra?: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const c = PLATFORM_CONSTRAINTS[platform];
  const errors: string[] = [];

  if (c.maxChars !== null && content.length > c.maxChars) {
    errors.push(
      `Content exceeds ${c.maxChars} character limit (${content.length} used).`,
    );
  }

  if (c.titleMaxChars && extra?.title) {
    const title = String(extra.title);
    if (title.length > c.titleMaxChars) {
      errors.push(
        `Title exceeds ${c.titleMaxChars} character limit (${title.length} used).`,
      );
    }
  }

  if (c.maxHashtags) {
    const hashtags = (content.match(/#\w+/g) ?? []).length;
    if (hashtags > c.maxHashtags) {
      errors.push(`Too many hashtags: max ${c.maxHashtags}, found ${hashtags}.`);
    }
  }

  return { valid: errors.length === 0, errors };
}
