import { BlockStack, Card, Text, InlineGrid, Box, InlineStack, Icon } from "@shopify/polaris";
import { CheckIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { Platform, PostType } from "../../types/post.js";
import { PLATFORM_CONSTRAINTS, getPlatformsForPostType } from "../../utils/platformConstraints.js";

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
            const isConnected = connectedPlatforms.includes(platform);
            const isSelected = selected.includes(platform);
            const isDisabled = !isConnected;

            return (
              <Box
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
                      {!isConnected && (
                        <Text as="p" variant="bodySm" tone="critical">Not connected</Text>
                      )}
                    </BlockStack>
                  </InlineStack>
                  {isSelected && <Icon source={CheckIcon} tone="success" />}
                  {isDisabled && !isSelected && <Icon source={AlertCircleIcon} tone="caution" />}
                </InlineStack>
              </Box>
            );
          })}
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}
