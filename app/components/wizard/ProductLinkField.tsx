import { useCallback, useState } from "react";
import { BlockStack, InlineStack, Text, Button, Box, Select } from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { LinkedProduct } from "../../types/post.js";
import { DEFAULT_VARIANT_TITLE, buildProductUrl } from "../../utils/product.js";

interface ProductLinkFieldProps {
  product: LinkedProduct | null;
  shop: string;
  onChange: (product: LinkedProduct | null) => void;
  onInsertLink: () => void;
}

/** A variant the merchant can link, taken from the resource picker payload. */
interface PickedVariant {
  id: string;
  title: string;
}

const NO_VARIANT = "";

export function ProductLinkField({ product, shop, onChange, onInsertLink }: ProductLinkFieldProps) {
  const appBridge = useAppBridge();

  // Variants come from the resource picker payload, so they are only known once
  // the merchant picks a product in this session. When an existing post is
  // opened for editing the stored variant is shown as plain text instead, and
  // picking the product again loads the full list.
  const [variants, setVariants] = useState<PickedVariant[]>([]);

  const pickProduct = useCallback(async () => {
    const selection = await appBridge.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
      ...(product ? { selectionIds: [{ id: product.id }] } : {}),
    });

    if (!selection || selection.length === 0) return;

    const picked = selection[0];

    // Products with no real variants come back with a single "Default Title"
    // variant, which is not worth offering as a choice.
    const pickedVariants: PickedVariant[] = [];
    for (const variant of picked.variants ?? []) {
      if (!variant.id || !variant.title || variant.title === DEFAULT_VARIANT_TITLE) continue;
      pickedVariants.push({ id: variant.id, title: variant.title });
    }
    setVariants(pickedVariants);

    // A new product selection always starts without a variant.
    onChange({
      id: picked.id,
      handle: picked.handle,
      title: picked.title,
      url: buildProductUrl(shop, picked.handle),
      variantId: null,
      variantTitle: null,
    });
  }, [appBridge, onChange, product, shop]);

  function removeProduct() {
    setVariants([]);
    onChange(null);
  }

  function selectVariant(value: string) {
    if (!product) return;
    const variant = variants.find((v) => v.id === value) ?? null;
    onChange({
      ...product,
      variantId: variant?.id ?? null,
      variantTitle: variant?.title ?? null,
      url: buildProductUrl(shop, product.handle, variant?.id ?? null),
    });
  }

  function clearVariant() {
    if (!product) return;
    onChange({
      ...product,
      variantId: null,
      variantTitle: null,
      url: buildProductUrl(shop, product.handle),
    });
  }

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

  const variantOptions = [
    { label: "No specific variant", value: NO_VARIANT },
    ...variants.map((v) => ({ label: v.title, value: v.id })),
  ];

  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <BlockStack gap="050">
          <Text as="p" variant="bodyMd" fontWeight="semibold">{product.title}</Text>
          <Text as="p" variant="bodySm" tone="subdued">{product.url}</Text>
        </BlockStack>
        <InlineStack gap="200">
          <Button onClick={pickProduct}>Change</Button>
          <Button tone="critical" onClick={removeProduct}>Remove</Button>
        </InlineStack>
      </InlineStack>

      {variants.length > 0 ? (
        <Select
          label="Link a specific variant"
          options={variantOptions}
          value={product.variantId ?? NO_VARIANT}
          onChange={selectVariant}
          helpText="The link opens the product page with this variant already selected."
        />
      ) : (
        product.variantTitle && (
          <InlineStack gap="200" blockAlign="center">
            <Text as="p" variant="bodySm" tone="subdued">
              Linked variant: {product.variantTitle}
            </Text>
            <Button variant="plain" onClick={clearVariant}>Clear variant</Button>
          </InlineStack>
        )
      )}

      <Box>
        <Button variant="plain" onClick={onInsertLink}>Insert link into caption</Button>
      </Box>
    </BlockStack>
  );
}
