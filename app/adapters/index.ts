import { Platform } from "../types/post.js";
import type { PlatformAdapter } from "./types.js";
import { twitterAdapter } from "./twitter.js";
import { instagramFeedAdapter, instagramReelsAdapter } from "./instagram.js";
import { facebookAdapter } from "./facebook.js";
import { tiktokAdapter } from "./tiktok.js";
import { linkedinAdapter } from "./linkedin.js";
import { redNoteAdapter } from "./rednote.js";
import { youtubeShortsAdapter } from "./youtube.js";

const registry = new Map<Platform, PlatformAdapter>([
  [Platform.Twitter, twitterAdapter],
  [Platform.InstagramFeed, instagramFeedAdapter],
  [Platform.InstagramReels, instagramReelsAdapter],
  [Platform.Facebook, facebookAdapter],
  [Platform.TikTok, tiktokAdapter],
  [Platform.LinkedIn, linkedinAdapter],
  [Platform.RedNote, redNoteAdapter],
  [Platform.YouTubeShorts, youtubeShortsAdapter],
]);

export function getAdapter(platform: Platform): PlatformAdapter {
  const adapter = registry.get(platform);
  if (!adapter) throw new Error(`No adapter registered for platform: ${platform}`);
  return adapter;
}

export { registry };
