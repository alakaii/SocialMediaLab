import { BlockStack, Card, Text, Tabs } from "@shopify/polaris";
import { useState } from "react";
import { Platform } from "../../types/post.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import type {
  WizardMediaAsset,
  PlatformOverride,
  LinkedProduct,
} from "../../types/post.js";

import { PostPreview } from "./PostPreview.js";
import { TwitterEditor } from "../platform-editors/TwitterEditor.js";
import { InstagramFeedEditor } from "../platform-editors/InstagramFeedEditor.js";
import { InstagramReelsEditor } from "../platform-editors/InstagramReelsEditor.js";
import { TikTokEditor } from "../platform-editors/TikTokEditor.js";
import { FacebookEditor } from "../platform-editors/FacebookEditor.js";
import { LinkedInEditor } from "../platform-editors/LinkedInEditor.js";
import { RedNoteEditor } from "../platform-editors/RedNoteEditor.js";
import { YouTubeShortsEditor } from "../platform-editors/YouTubeShortsEditor.js";
import { DefaultEditor } from "../platform-editors/DefaultEditor.js";

interface StepPlatformAdjustProps {
  platforms: Platform[];
  mainContent: string;
  mediaAssets: WizardMediaAsset[];
  overrides: Partial<Record<Platform, PlatformOverride>>;
  onOverrideChange: (platform: Platform, override: PlatformOverride) => void;
  brandName: string;
  brandLogoUrl?: string | null;
  // Names of the selected accounts on each platform. The preview names the
  // account only when a single one is targeted, since a shared override applies
  // to every account on that platform.
  accountNamesByPlatform: Partial<Record<Platform, string[]>>;
  product: LinkedProduct | null;
}

/**
 * Final step of the wizard: a preview of the post on top, and the per-platform
 * customization editors underneath. One tab strip drives both, so switching
 * platforms flips the preview and the editor together, and every edit below
 * updates the preview above straight away.
 */
export function StepPlatformAdjust({
  platforms,
  mainContent,
  mediaAssets,
  overrides,
  onOverrideChange,
  brandName,
  brandLogoUrl,
  accountNamesByPlatform,
  product,
}: StepPlatformAdjustProps) {
  const [selectedTab, setSelectedTab] = useState(0);

  const tabs = platforms.map((platform) => ({
    id: platform,
    content: `${PLATFORM_CONSTRAINTS[platform].icon} ${PLATFORM_CONSTRAINTS[platform].label}`,
  }));

  // A platform can drop out of the selection after a tab was picked, so clamp
  // rather than trusting the stored index.
  const activeTab = Math.min(selectedTab, Math.max(platforms.length - 1, 0));
  const currentPlatform = platforms[activeTab];
  const override = currentPlatform ? overrides[currentPlatform] ?? {} : {};
  const content = override.content ?? mainContent;
  const extra = (override.extra ?? {}) as Record<string, unknown>;

  const accountNames = currentPlatform
    ? accountNamesByPlatform[currentPlatform] ?? []
    : [];
  const previewAccountName = accountNames.length === 1 ? accountNames[0] : null;
  const previewTitle =
    typeof extra.title === "string" && extra.title.trim().length > 0
      ? extra.title
      : undefined;

  function handleChange(newContent: string, newExtra?: Record<string, unknown>) {
    if (!currentPlatform) return;
    onOverrideChange(currentPlatform, {
      content: newContent,
      extra: newExtra ?? extra,
    });
  }

  function renderEditor() {
    if (!currentPlatform) return null;
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
        return (
          <DefaultEditor
            platform={currentPlatform}
            content={content}
            onChange={handleChange}
          />
        );
    }
  }

  if (!currentPlatform) {
    return (
      <Card>
        <Text as="p" tone="subdued">
          Go back and pick at least one account or platform for this post.
        </Text>
      </Card>
    );
  }

  return (
    <BlockStack gap="500">
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">Review your post</Text>
            <Text as="p" tone="subdued">
              Check how it reads on each platform, then fine-tune the wording below.
            </Text>
          </BlockStack>

          <Tabs tabs={tabs} selected={activeTab} onSelect={setSelectedTab} />

          <PostPreview
            platform={currentPlatform}
            brandName={brandName}
            brandLogoUrl={brandLogoUrl}
            accountName={previewAccountName}
            content={content}
            title={previewTitle}
            mediaAssets={mediaAssets}
            product={product}
          />
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {`Customize for ${PLATFORM_CONSTRAINTS[currentPlatform].label}`}
            </Text>
            <Text as="p" tone="subdued">
              Your main content is pre-filled. Adjust text, hashtags, and settings
              to match this platform{"'"}s style. Changes show up in the preview
              above.
              {accountNames.length > 1
                ? ` These changes apply to all ${accountNames.length} accounts on this platform.`
                : ""}
            </Text>
          </BlockStack>

          {renderEditor()}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
