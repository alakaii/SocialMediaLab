import { BlockStack, Card, Text, ResourceList, ResourceItem, Avatar, InlineStack, Badge } from "@shopify/polaris";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import type { Platform } from "../../types/post.js";

interface BrandAccount {
  id: string;
  platform: Platform;
  accountName: string | null;
}

interface Brand {
  id: string;
  name: string;
  logoUrl?: string | null;
  timezone: string;
  accounts: BrandAccount[];
}

interface StepBrandProps {
  brands: Brand[];
  selectedId: string | null;
  onChange: (brandId: string) => void;
}

export function StepBrand({ brands, selectedId, onChange }: StepBrandProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">Select a brand</Text>
        {brands.length === 0 ? (
          <Text as="p" tone="subdued">No brands yet. Create one in the Brands section first.</Text>
        ) : (
          <ResourceList
            items={brands}
            renderItem={(brand) => (
              <ResourceItem
                id={brand.id}
                onClick={() => onChange(brand.id)}
                verticalAlignment="center"
                media={<Avatar size="md" name={brand.name} source={brand.logoUrl ?? undefined} />}
                name={brand.name}
              >
                <InlineStack align="space-between">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight={selectedId === brand.id ? "bold" : "regular"}>
                      {brand.name}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">{brand.timezone}</Text>
                  </BlockStack>
                  <InlineStack gap="100">
                    {brand.accounts.map((a) => (
                      <Badge key={a.id} size="small">
                        {`${PLATFORM_CONSTRAINTS[a.platform]?.icon ?? ""} ${a.accountName ?? PLATFORM_CONSTRAINTS[a.platform]?.label ?? a.platform}`}
                      </Badge>
                    ))}
                    {selectedId === brand.id && <Badge tone="success">Selected</Badge>}
                  </InlineStack>
                </InlineStack>
              </ResourceItem>
            )}
          />
        )}
      </BlockStack>
    </Card>
  );
}
