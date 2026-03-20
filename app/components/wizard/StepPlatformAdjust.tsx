import { BlockStack, Card, Text, Tabs } from "@shopify/polaris";
import { useState } from "react";
import { Platform } from "../../types/post.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import type { WizardMediaAsset, PlatformOverride } from "../../types/post.js";

import { TwitterEditor } from "../platform-editors/TwitterEditor.js";
import { InstagramFeedEditor } from "../platform-editors/InstagramFeedEditor.js";
import { InstagramReelsEditor } from "../platform-editors/InstagramReelsEditor.js";
import { TikTokEditor } from "../platform-editors/TikTokEditor.js";
import { FacebookEditor } from "../platform-editors/FacebookEditor.js";
import { LinkedInEditor } from "../platform-editors/LinkedInEditor.js";
import { RedNoteEditor } from "../platform-editors/RedNoteEditor.js";
import { YouTubeShortsEditor } from "../platform-editors/YouTubeShortsEditor.js";

interface StepPlatformAdjustProps {
  platforms: Platform[];
  mainContent: string;
  mediaAssets: WizardMediaAsset[];
  overrides: Partial<Record<Platform, PlatformOverride>>;
  onOverrideChange: (platform: Platform, override: PlatformOverride) => void;
}

export function StepPlatformAdjust({
  platforms,
  mainContent,
  mediaAssets,
  overrides,
  onOverrideChange,
}: StepPlatformAdjustProps) {
  const [selectedTab, setSelectedTab] = useState(0);

  const tabs = platforms.map((platform) => ({
    id: platform,
    content: `${PLATFORM_CONSTRAINTS[platform].icon} ${PLATFORM_CONSTRAINTS[platform].label}`,
  }));

  const currentPlatform = platforms[selectedTab];
  const override = overrides[currentPlatform] ?? {};
  const content = override.content ?? mainContent;
  const extra = (override.extra ?? {}) as Record<string, unknown>;

  function handleChange(newContent: string, newExtra?: Record<string, unknown>) {
    onOverrideChange(currentPlatform, {
      content: newContent,
      extra: newExtra ?? extra,
    });
  }

  function renderEditor() {
    const props = { content, extra, mediaAssets, onChange: handleChange };

    switch (currentPlatform) {
      case Platform.Twitter:
        return <TwitterEditor {...props} />;
      case Platform.InstagramFeed:
        return <InstagramFeedEditor {...props} />;
      case Platform.InstagramReels:
        return <InstagramReelsEditor {...props} />;
      case Platform.TikTok:
        return <TikTokEditor {...props} />;
      case Platform.Facebook:
        return <FacebookEditor {...props} />;
      case Platform.LinkedIn:
        return <LinkedInEditor {...props} />;
      case Platform.RedNote:
        return <RedNoteEditor {...props} />;
      case Platform.YouTubeShorts:
        return <YouTubeShortsEditor {...props} />;
      default:
        return null;
    }
  }

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">Fine-tune for each platform</Text>
          <Text as="p" tone="subdued">
            Your main content is pre-filled. Adjust text, hashtags, and settings to match each platform{"'"}s style.
          </Text>
        </BlockStack>

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />

        {currentPlatform && renderEditor()}
      </BlockStack>
    </Card>
  );
}
