import { BlockStack, TextField, Text, Banner, InlineStack } from "@shopify/polaris";
import { CharacterCounter } from "../shared/CharacterCounter.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { Platform } from "../../types/post.js";
import { countHashtags } from "../../utils/hashtag.js";

interface LinkedInEditorProps {
  content: string;
  extra: Record<string, unknown>;
  onChange: (content: string, extra?: Record<string, unknown>) => void;
}

const c = PLATFORM_CONSTRAINTS[Platform.LinkedIn];

export function LinkedInEditor({ content, extra, onChange }: LinkedInEditorProps) {
  const hashtagCount = countHashtags(content);

  return (
    <BlockStack gap="300">
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          {c.icon} <strong>{c.label}</strong> — {c.note}
        </Text>
      </Banner>

      <TextField
        label="Post text"
        multiline={8}
        value={content}
        onChange={(v) => onChange(v, extra)}
        autoComplete="off"
        placeholder="Share professional insights, news, or stories..."
      />

      <InlineStack align="space-between">
        <CharacterCounter current={content.length} max={c.maxChars} />
        <Text as="span" variant="bodySm" tone="subdued">
          {hashtagCount} hashtags
        </Text>
      </InlineStack>

      <TextField
        label="External link (optional)"
        value={(extra.linkUrl as string | undefined) ?? ""}
        onChange={(v) => onChange(content, { ...extra, linkUrl: v })}
        autoComplete="off"
        placeholder="https://..."
        helpText="Adds a link preview card to the post."
      />
    </BlockStack>
  );
}
