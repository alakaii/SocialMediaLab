import { BlockStack, TextField, Text, Banner, InlineStack } from "@shopify/polaris";
import { CharacterCounter } from "../shared/CharacterCounter.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { Platform } from "../../types/post.js";
import { countHashtags } from "../../utils/hashtag.js";

interface DefaultEditorProps {
  platform: Platform;
  content: string;
  onChange: (content: string, extra?: Record<string, unknown>) => void;
}

/**
 * Caption editor for platforms with no settings of their own (Bluesky today).
 * Keeps every targeted platform editable on the review step instead of leaving
 * a gap where a dedicated editor does not exist.
 */
export function DefaultEditor({ platform, content, onChange }: DefaultEditorProps) {
  const c = PLATFORM_CONSTRAINTS[platform];
  const hashtagCount = countHashtags(content);

  return (
    <BlockStack gap="300">
      {c.note && (
        <Banner tone="info">
          <Text as="p" variant="bodySm">
            {c.icon} <strong>{c.label}</strong> — {c.note}
          </Text>
        </Banner>
      )}

      <TextField
        label="Post text"
        multiline={5}
        value={content}
        onChange={(v) => onChange(v)}
        autoComplete="off"
        placeholder="Share something with your audience..."
      />

      <InlineStack align="space-between">
        <CharacterCounter current={content.length} max={c.maxChars} />
        <Text as="span" variant="bodySm" tone="subdued">
          {hashtagCount} hashtag{hashtagCount !== 1 ? "s" : ""}
        </Text>
      </InlineStack>
    </BlockStack>
  );
}
