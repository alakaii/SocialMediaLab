import { BlockStack, TextField, Text, Banner, Checkbox } from "@shopify/polaris";
import { CharacterCounter } from "../shared/CharacterCounter.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { Platform } from "../../types/post.js";

interface FacebookEditorProps {
  content: string;
  extra: Record<string, unknown>;
  onChange: (content: string, extra?: Record<string, unknown>) => void;
}

const c = PLATFORM_CONSTRAINTS[Platform.Facebook];

export function FacebookEditor({ content, extra, onChange }: FacebookEditorProps) {
  const linkPreview = (extra.linkPreview as boolean | undefined) ?? true;

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
        onChange={(v) => onChange(v, { ...extra })}
        autoComplete="off"
        placeholder="Share something with your audience..."
      />

      <CharacterCounter current={content.length} max={c.maxChars} />

      <Checkbox
        label="Enable link preview (if content contains a URL)"
        checked={linkPreview}
        onChange={(v) => onChange(content, { ...extra, linkPreview: v })}
      />
    </BlockStack>
  );
}
