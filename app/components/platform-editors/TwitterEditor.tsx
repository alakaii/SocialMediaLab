import { BlockStack, TextField, Text, Banner, InlineStack } from "@shopify/polaris";
import { CharacterCounter } from "../shared/CharacterCounter.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { Platform } from "../../types/post.js";
import { countHashtags } from "../../utils/hashtag.js";
import type { WizardMediaAsset } from "../../types/post.js";

interface TwitterEditorProps {
  content: string;
  mediaAssets: WizardMediaAsset[];
  onChange: (content: string, extra?: Record<string, unknown>) => void;
}

const c = PLATFORM_CONSTRAINTS[Platform.Twitter];

export function TwitterEditor({ content, mediaAssets, onChange }: TwitterEditorProps) {
  const images = mediaAssets.filter((a) => a.mimeType.startsWith("image/"));
  const videos = mediaAssets.filter((a) => a.mimeType.startsWith("video/"));
  const hashtagCount = countHashtags(content);

  return (
    <BlockStack gap="300">
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          {c.icon} <strong>{c.label}</strong> — {c.note}
        </Text>
      </Banner>

      <TextField
        label="Tweet text"
        multiline={4}
        value={content}
        onChange={(v) => onChange(v)}
        autoComplete="off"
        maxLength={c.maxChars}
        showCharacterCount
      />

      <InlineStack align="space-between">
        <CharacterCounter current={content.length} max={c.maxChars} />
        <Text as="span" variant="bodySm" tone="subdued">
          {hashtagCount} hashtag{hashtagCount !== 1 ? "s" : ""} · {images.length}/{c.maxImages} images
        </Text>
      </InlineStack>

      {images.length > (c.maxImages ?? 4) && (
        <Banner tone="warning">Only the first {c.maxImages} images will be used.</Banner>
      )}
      {videos.length > 1 && (
        <Banner tone="warning">Twitter supports only 1 video per tweet. Only the first will be used.</Banner>
      )}
    </BlockStack>
  );
}
