import { BlockStack, TextField, Text, Banner, InlineStack } from "@shopify/polaris";
import { CharacterCounter } from "../shared/CharacterCounter.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { Platform } from "../../types/post.js";
import { countHashtags } from "../../utils/hashtag.js";
import type { WizardMediaAsset } from "../../types/post.js";

interface TikTokEditorProps {
  content: string;
  mediaAssets: WizardMediaAsset[];
  onChange: (content: string, extra?: Record<string, unknown>) => void;
}

const c = PLATFORM_CONSTRAINTS[Platform.TikTok];

export function TikTokEditor({ content, mediaAssets, onChange }: TikTokEditorProps) {
  const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));
  const durationOk = !video?.durationSec || video.durationSec <= (c.videoMaxSec ?? 600);
  const hashtagCount = countHashtags(content);

  return (
    <BlockStack gap="300">
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          {c.icon} <strong>{c.label}</strong> — {c.note}
        </Text>
      </Banner>

      {!durationOk && (
        <Banner tone="critical">
          Video is {Math.round(video!.durationSec!)}s — max {c.videoMaxSec}s for TikTok.
        </Banner>
      )}

      <TextField
        label="Caption + hashtags"
        multiline={5}
        value={content}
        onChange={(v) => onChange(v)}
        autoComplete="off"
        placeholder="Add your caption and #hashtags..."
      />

      <InlineStack align="space-between">
        <CharacterCounter current={content.length} max={c.maxChars} />
        <Text as="span" variant="bodySm" tone="subdued">
          {hashtagCount} hashtags
        </Text>
      </InlineStack>
    </BlockStack>
  );
}
