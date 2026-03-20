import { BlockStack, TextField, Text, Banner, InlineStack, Tag } from "@shopify/polaris";
import { useState } from "react";
import { CharacterCounter } from "../shared/CharacterCounter.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { Platform } from "../../types/post.js";

interface RedNoteEditorProps {
  content: string;
  extra: Record<string, unknown>;
  onChange: (content: string, extra?: Record<string, unknown>) => void;
}

const c = PLATFORM_CONSTRAINTS[Platform.RedNote];

export function RedNoteEditor({ content, extra, onChange }: RedNoteEditorProps) {
  const [tagInput, setTagInput] = useState("");
  const tags = (extra.tags as string[] | undefined) ?? [];
  const title = (extra.title as string | undefined) ?? "";

  function addTag() {
    const tag = tagInput.trim().replace(/^#/, "");
    if (tag && !tags.includes(tag)) {
      onChange(content, { ...extra, tags: [...tags, tag] });
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    onChange(content, { ...extra, tags: tags.filter((t) => t !== tag) });
  }

  return (
    <BlockStack gap="300">
      <Banner tone="info">
        <Text as="p" variant="bodySm">
          {c.icon} <strong>{c.label}</strong> — {c.note}
        </Text>
      </Banner>

      <TextField
        label="Note title"
        value={title}
        onChange={(v) => onChange(content, { ...extra, title: v })}
        autoComplete="off"
        placeholder="Catchy title for your note..."
        maxLength={20}
        showCharacterCount
      />

      <TextField
        label="Note content"
        multiline={6}
        value={content}
        onChange={(v) => onChange(v, extra)}
        autoComplete="off"
        placeholder="Tell your story in a lifestyle, note-style way..."
      />

      <InlineStack align="space-between">
        <CharacterCounter current={content.length} max={c.maxChars} />
        <Text as="span" variant="bodySm" tone="subdued">{tags.length}/{c.maxHashtags} tags</Text>
      </InlineStack>

      <TextField
        label="Add tag"
        value={tagInput}
        onChange={setTagInput}
        onBlur={addTag}
        autoComplete="off"
        placeholder="lifestyle, fashion, beauty..."
        connectedRight={
          <button onClick={addTag} style={{ padding: "0 12px", cursor: "pointer" }}>+ Add</button>
        }
      />

      {tags.length > 0 && (
        <InlineStack gap="150" wrap>
          {tags.map((tag) => (
            <Tag key={tag} onRemove={() => removeTag(tag)}>#{tag}</Tag>
          ))}
        </InlineStack>
      )}
    </BlockStack>
  );
}
