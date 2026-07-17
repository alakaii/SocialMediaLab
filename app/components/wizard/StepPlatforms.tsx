import { BlockStack, Card, Text, InlineGrid, Box, InlineStack, Icon, Link } from "@shopify/polaris";
import type { BoxProps } from "@shopify/polaris";
import type { ComponentType } from "react";
import { CheckIcon } from "@shopify/polaris-icons";
import { Platform, PostType } from "../../types/post.js";
import {
  PLATFORM_CONSTRAINTS,
  getPlatformsForPostType,
  MANUAL_PLATFORMS,
} from "../../utils/platformConstraints.js";

// Box renders its `as` element via React.createElement and forwards extra props
// (like onClick) at runtime, but its types omit the 'button' element and onClick.
const ClickableBox = Box as ComponentType<
  Omit<BoxProps, "as"> & { as?: "button"; onClick?: () => void }
>;

interface WizardAccount {
  id: string;
  platform: Platform;
  accountName: string | null;
}

interface StepPlatformsProps {
  postType: PostType;
  accounts: WizardAccount[];
  selectedAccountIds: string[];
  manualPlatforms: Platform[];
  onAccountsChange: (ids: string[]) => void;
  onManualChange: (platforms: Platform[]) => void;
}

function SelectableTile({
  icon,
  title,
  subtitle,
  selected,
  onToggle,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <ClickableBox
      padding="400"
      background={selected ? "bg-surface-selected" : "bg-surface"}
      borderColor={selected ? "border-emphasis" : "border"}
      borderWidth="025"
      borderRadius="200"
      as="button"
      onClick={onToggle}
    >
      <InlineStack align="space-between" blockAlign="center">
        <InlineStack gap="300" blockAlign="center">
          <Text as="span" variant="headingLg">{icon}</Text>
          <BlockStack gap="0">
            <Text as="p" variant="bodyMd" fontWeight="semibold">{title}</Text>
            {subtitle && (
              <Text as="p" variant="bodySm" tone="subdued">{subtitle}</Text>
            )}
          </BlockStack>
        </InlineStack>
        {selected && <Icon source={CheckIcon} tone="success" />}
      </InlineStack>
    </ClickableBox>
  );
}

export function StepPlatforms({
  postType,
  accounts,
  selectedAccountIds,
  manualPlatforms,
  onAccountsChange,
  onManualChange,
}: StepPlatformsProps) {
  const compatible = new Set(getPlatformsForPostType(postType));

  // Connected accounts of the chosen brand that support this post type.
  const compatibleAccounts = accounts.filter((a) => compatible.has(a.platform));

  // Manual platforms (e.g. RedNote) supported by this post type. They need no
  // connection, so they are always selectable and never pre-checked.
  const manualOptions = [...MANUAL_PLATFORMS].filter((p) => compatible.has(p));

  function toggleAccount(id: string) {
    if (selectedAccountIds.includes(id)) {
      onAccountsChange(selectedAccountIds.filter((x) => x !== id));
    } else {
      onAccountsChange([...selectedAccountIds, id]);
    }
  }

  function toggleManual(platform: Platform) {
    if (manualPlatforms.includes(platform)) {
      onManualChange(manualPlatforms.filter((p) => p !== platform));
    } else {
      onManualChange([...manualPlatforms, platform]);
    }
  }

  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">Where should this post go?</Text>
          <Text as="p" tone="subdued">
            Your connected accounts for this brand are pre-selected. Uncheck any
            you want to skip.
          </Text>
        </BlockStack>

        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Connected accounts</Text>
          {compatibleAccounts.length === 0 ? (
            <Text as="p" tone="subdued">
              This brand has no connected accounts for this post type. Add one on
              the{" "}
              <Link url="/app/connections">Connections</Link> page, or pick a
              manual platform below.
            </Text>
          ) : (
            <InlineGrid columns={2} gap="300">
              {compatibleAccounts.map((account) => {
                const c = PLATFORM_CONSTRAINTS[account.platform];
                return (
                  <SelectableTile
                    key={account.id}
                    icon={c.icon}
                    title={account.accountName ?? c.label}
                    subtitle={c.label}
                    selected={selectedAccountIds.includes(account.id)}
                    onToggle={() => toggleAccount(account.id)}
                  />
                );
              })}
            </InlineGrid>
          )}
        </BlockStack>

        {manualOptions.length > 0 && (
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Manual platforms</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              These have no posting API. The app preps your post at the scheduled
              time and you copy-paste it into the app.
            </Text>
            <InlineGrid columns={2} gap="300">
              {manualOptions.map((platform) => {
                const c = PLATFORM_CONSTRAINTS[platform];
                return (
                  <SelectableTile
                    key={platform}
                    icon={c.icon}
                    title={c.label}
                    subtitle="Manual posting"
                    selected={manualPlatforms.includes(platform)}
                    onToggle={() => toggleManual(platform)}
                  />
                );
              })}
            </InlineGrid>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}
