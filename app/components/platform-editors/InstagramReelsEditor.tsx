import { BlockStack, TextField, Text, Banner, InlineStack } from "@shopify/polaris";
import { CharacterCounter } from "../shared/CharacterCounter.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { Platform } from "../../types/post.js";
import { countHashtags } from "../../utils/hashtag.js";
import type { WizardMediaAsset } from "../../types/post.js";

interface InstagramReelsEditorProps {
  content: string;
  mediaAssets: WizardMediaAsset[];
  onChange: (content: string, extra?: Record<string, unknown>) => void;
}

const c = PLATFORM_CONSTRAINTS[Platform.InstagramReels];

export function InstagramReelsEditor({ content, mediaAssets, onChange }: InstagramReelsEditorProps) {
  const hashtagCount = countHashtags(content);
  const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));
  const durationOk = !video?.durationSec || video.durationSec <= (c.videoMaxSec ?? 90);

  return (
    <BlockStack gap="300">
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          {c.icon} <strong>{c.label}</strong> — 9:16 vertical video, max {c.videoMaxSec}s
        </Text>
      </Banner>

      {!durationOk && (
        <Banner tone="critical">
          Video is {Math.round(video!.durationSec!)}s — max {c.videoMaxSec}s for Reels.
        </Banner>
      )}

      <TextField
        label="Caption"
        multiline={4}
        value={content}
        onChange={(v) => onChange(v)}
        autoComplete="off"
      />

      <InlineStack align="space-between">
        <CharacterCounter current={content.length} max={c.maxChars} />
        <Text as="span" variant="bodySm" tone={hashtagCount > (c.maxHashtags ?? 30) ? "critical" : "subdued"}>
          {hashtagCount}/{c.maxHashtags} hashtags
        </Text>
      </InlineStack>
    </BlockStack>
  );
}
