import { BlockStack, Card, Text, InlineGrid, Box, InlineStack, Icon } from "@shopify/polaris";
import type { BoxProps } from "@shopify/polaris";
import type { ComponentType } from "react";
import { CheckIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { Platform, PostType } from "../../types/post.js";
import { PLATFORM_CONSTRAINTS, getPlatformsForPostType, isManualPlatform } from "../../utils/platformConstraints.js";

// Box renders its `as` element via React.createElement and forwards extra props
// (like onClick) at runtime, but its types omit the 'button' element and onClick.
const ClickableBox = Box as ComponentType<
  Omit<BoxProps, "as"> & { as?: "button"; onClick?: () => void }
>;

interface StepPlatformsProps {
  postType: PostType;
  connectedPlatforms: Platform[];
  selected: Platform[];
  onChange: (platforms: Platform[]) => void;
}

export function StepPlatforms({ postType, connectedPlatforms, selected, onChange }: StepPlatformsProps) {
  const compatible = getPlatformsForPostType(postType);

  function toggle(platform: Platform) {
    if (selected.includes(platform)) {
      onChange(selected.filter((p) => p !== platform));
    } else {
      onChange([...selected, platform]);
    }
  }

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">Where should this post go?</Text>
        <Text as="p" tone="subdued">Only platforms compatible with your post type are shown.</Text>
        <InlineGrid columns={2} gap="300">
          {compatible.map((platform) => {
            const c = PLATFORM_CONSTRAINTS[platform];
            // Manual platforms (e.g. RedNote) are posted by copy-paste and need
            // no token connection, so they are always selectable.
            const isManual = isManualPlatform(platform);
            const isConnected = connectedPlatforms.includes(platform);
            const isSelected = selected.includes(platform);
            const isDisabled = !isConnected && !isManual;

            return (
              <ClickableBox
                key={platform}
                padding="400"
                background={isSelected ? "bg-surface-selected" : isDisabled ? "bg-surface-disabled" : "bg-surface"}
                borderColor={isSelected ? "border-emphasis" : "border"}
                borderWidth="025"
                borderRadius="200"
                as="button"
                onClick={() => !isDisabled && toggle(platform)}
              >
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="300" blockAlign="center">
                    <Text as="span" variant="headingLg">{c.icon}</Text>
                    <BlockStack gap="0">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{c.label}</Text>
                      {isManual ? (
                        <Text as="p" variant="bodySm" tone="subdued">Manual posting</Text>
                      ) : !isConnected ? (
                        <Text as="p" variant="bodySm" tone="critical">Not connected</Text>
                      ) : null}
                    </BlockStack>
                  </InlineStack>
                  {isSelected && <Icon source={CheckIcon} tone="success" />}
                  {isDisabled && !isSelected && <Icon source={AlertCircleIcon} tone="caution" />}
                </InlineStack>
              </ClickableBox>
            );
          })}
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}
