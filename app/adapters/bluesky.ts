import {
  AtpAgent,
  RichText,
  AppBskyEmbedImages,
} from "@atproto/api";
import { Platform } from "../types/post.js";
import type { PlatformAdapter, PublishPayload, PublishResult } from "./types.js";

const BLUESKY_SERVICE = "https://bsky.social";

// Bluesky caps posts at 300 graphemes and allows up to 4 images per post.
const MAX_GRAPHEMES = 300;
const MAX_IMAGES = 4;

// Count user-perceived characters (graphemes) rather than UTF-16 code units so
// emoji and combined characters are measured the way Bluesky measures them.
function graphemeLength(text: string): number {
  // Intl.Segmenter is available on Node 22 (this project's runtime).
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

export const blueskyAdapter: PlatformAdapter = {
  platform: Platform.Bluesky,

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { accessToken, tokenSecret, accountId, content, mediaAssets } = payload;

    // Bluesky uses app passwords. The connect flow stores:
    //   accessToken  = app password
    //   tokenSecret  = handle (e.g. name.bsky.social)
    //   accountId    = DID
    const identifier = tokenSecret || accountId;
    if (!identifier) {
      throw new Error("Bluesky: missing account handle. Reconnect the account.");
    }

    if (graphemeLength(content) > MAX_GRAPHEMES) {
      throw new Error(
        `Bluesky: post exceeds the ${MAX_GRAPHEMES} character limit.`,
      );
    }

    // Bluesky does not support video posting through this adapter yet. The
    // video upload service requires a separate job-based flow, so fail clearly
    // rather than publishing a half-working post.
    const hasVideo = mediaAssets.some((a) => a.mimeType.startsWith("video/"));
    if (hasVideo) {
      throw new Error("Bluesky video posting not supported yet");
    }

    const agent = new AtpAgent({ service: BLUESKY_SERVICE });
    await agent.login({ identifier, password: accessToken });

    // Detect facets (links, mentions, tags) so they render as clickable.
    const richText = new RichText({ text: content });
    await richText.detectFacets(agent);

    const images = mediaAssets.filter((a) => a.mimeType.startsWith("image/"));

    type PostRecord = Parameters<typeof agent.post>[0];
    let embed: PostRecord["embed"];
    if (images.length > 0) {
      const uploaded = await Promise.all(
        images.slice(0, MAX_IMAGES).map(async (asset) => {
          const response = await fetch(asset.url);
          if (!response.ok) {
            throw new Error(
              `Bluesky: failed to download media (${response.status}).`,
            );
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          const result = await agent.uploadBlob(bytes, {
            encoding: asset.mimeType,
          });
          const image: AppBskyEmbedImages.Image = {
            image: result.data.blob,
            alt: asset.altText ?? "",
          };
          return image;
        }),
      );

      embed = {
        $type: "app.bsky.embed.images",
        images: uploaded,
      };
    }

    const { uri, cid } = await agent.post({
      text: richText.text,
      facets: richText.facets,
      embed,
      createdAt: new Date().toISOString(),
    });

    // Build a browsable web URL from the at:// uri: at://<did>/app.bsky.feed.post/<rkey>
    const rkey = uri.split("/").pop() ?? "";
    const handle = tokenSecret || accountId;
    const url =
      rkey && handle
        ? `https://bsky.app/profile/${handle}/post/${rkey}`
        : undefined;

    // cid is part of the record identity; kept in the log context via the uri.
    void cid;

    return {
      platformPostId: uri,
      url,
    };
  },
};
