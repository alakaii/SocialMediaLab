import { useCallback } from "react";
import { BlockStack, InlineStack, Text, Button, Box } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { LinkedProduct } from "../../types/post.js";

interface ProductLinkFieldProps {
  product: LinkedProduct | null;
  shop: string;
  onChange: (product: LinkedProduct | null) => void;
  onInsertLink: () => void;
}

export function ProductLinkField({ product, shop, onChange, onInsertLink }: ProductLinkFieldProps) {
  const appBridge = useAppBridge();

  const pickProduct = useCallback(async () => {
    const selection = await appBridge.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
      ...(product ? { selectionIds: [{ id: product.id }] } : {}),
    });

    if (!selection || selection.length === 0) return;

    const picked = selection[0];
    onChange({
      id: picked.id,
      handle: picked.handle,
      title: picked.title,
      url: `https://${shop}/products/${picked.handle}`,
    });
  }, [appBridge, onChange, product, shop]);

  if (!product) {
    return (
      <BlockStack gap="200">
        <Text as="p" tone="subdued">
          Link a product to this post so its images, hashtags, and storefront link are one click away.
        </Text>
        <Box>
          <Button onClick={pickProduct}>Link a product</Button>
        </Box>
      </BlockStack>
    );
  }

  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <BlockStack gap="050">
          <Text as="p" variant="bodyMd" fontWeight="semibold">{product.title}</Text>
          <Text as="p" variant="bodySm" tone="subdued">{product.url}</Text>
        </BlockStack>
        <InlineStack gap="200">
          <Button onClick={pickProduct}>Change</Button>
          <Button tone="critical" onClick={() => onChange(null)}>Remove</Button>
        </InlineStack>
      </InlineStack>
      <Box>
        <Button variant="plain" onClick={onInsertLink}>Insert link into caption</Button>
      </Box>
    </BlockStack>
  );
}
