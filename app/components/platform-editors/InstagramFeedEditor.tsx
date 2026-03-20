import { BlockStack, TextField, Text, Banner, InlineStack, Select } from "@shopify/polaris";
import { CharacterCounter } from "../shared/CharacterCounter.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { Platform } from "../../types/post.js";
import { countHashtags } from "../../utils/hashtag.js";

interface InstagramFeedEditorProps {
  content: string;
  extra: Record<string, unknown>;
  onChange: (content: string, extra?: Record<string, unknown>) => void;
}

const c = PLATFORM_CONSTRAINTS[Platform.InstagramFeed];

export function InstagramFeedEditor({ content, extra, onChange }: InstagramFeedEditorProps) {
  const hashtagCount = countHashtags(content);
  const ratio = (extra.ratio as string | undefined) ?? "4:5";

  return (
    <BlockStack gap="300">
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          {c.icon} <strong>{c.label}</strong> — {c.note}
        </Text>
      </Banner>

      <TextField
        label="Caption"
        multiline={6}
        value={content}
        onChange={(v) => onChange(v, { ...extra, ratio })}
        autoComplete="off"
        helpText="Put hashtags at the end or in the first comment."
      />

      <InlineStack align="space-between">
        <CharacterCounter current={content.length} max={c.maxChars} />
        <Text as="span" variant="bodySm" tone={hashtagCount > (c.maxHashtags ?? 30) ? "critical" : "subdued"}>
          {hashtagCount}/{c.maxHashtags} hashtags
        </Text>
      </InlineStack>

      <Select
        label="Image aspect ratio"
        options={(c.aspectRatios ?? []).map((r) => ({ label: r, value: r }))}
        value={ratio}
        onChange={(v) => onChange(content, { ...extra, ratio: v })}
        helpText="Choose the ratio that best suits your image."
      />

      {hashtagCount > (c.maxHashtags ?? 30) && (
        <Banner tone="critical">Too many hashtags. Max {c.maxHashtags} allowed.</Banner>
      )}
    </BlockStack>
  );
}
