import { BlockStack, TextField, Text, Banner, InlineStack } from "@shopify/polaris";
import { CharacterCounter } from "../shared/CharacterCounter.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { Platform } from "../../types/post.js";
import type { WizardMediaAsset } from "../../types/post.js";

interface YouTubeShortsEditorProps {
  content: string;
  extra: Record<string, unknown>;
  mediaAssets: WizardMediaAsset[];
  onChange: (content: string, extra?: Record<string, unknown>) => void;
}

const c = PLATFORM_CONSTRAINTS[Platform.YouTubeShorts];

export function YouTubeShortsEditor({ content, extra, mediaAssets, onChange }: YouTubeShortsEditorProps) {
  const title = (extra.title as string | undefined) ?? "";
  const video = mediaAssets.find((a) => a.mimeType.startsWith("video/"));
  const durationOk = !video?.durationSec || video.durationSec <= (c.videoMaxSec ?? 60);

  return (
    <BlockStack gap="300">
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          {c.icon} <strong>{c.label}</strong> — {c.note}
        </Text>
      </Banner>

      {!durationOk && (
        <Banner tone="critical">
          Video is {Math.round(video!.durationSec!)}s — YouTube Shorts max is {c.videoMaxSec}s.
        </Banner>
      )}

      <TextField
        label="Title (required)"
        value={title}
        onChange={(v) => onChange(content, { ...extra, title: v })}
        autoComplete="off"
        placeholder="Catchy title for discoverability..."
        maxLength={c.titleMaxChars}
        showCharacterCount
        helpText={`${title.length}/${c.titleMaxChars} characters`}
      />

      <TextField
        label="Description"
        multiline={6}
        value={content}
        onChange={(v) => onChange(v, extra)}
        autoComplete="off"
        placeholder="Describe your Short..."
      />

      <InlineStack align="space-between">
        <CharacterCounter current={content.length} max={c.maxChars} />
      </InlineStack>
    </BlockStack>
  );
}
