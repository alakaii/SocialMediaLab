import { useEffect, useMemo } from "react";
import { BlockStack, InlineStack, Text, Thumbnail, Spinner, Box, Badge } from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import type { WizardMediaAsset } from "../../types/post.js";

interface StoreMediaImage {
  url: string;
  altText: string | null;
  source: "product" | "variant" | "collection" | "blog";
  variantId?: string | null;
  variantTitle?: string | null;
}

interface StoreMediaPickerProps {
  productId: string | null;
  // Variant the post links, when the merchant picked one. Its image is listed
  // first and badged so it is easy to grab.
  variantId?: string | null;
  assets: WizardMediaAsset[];
  onChange: (assets: WizardMediaAsset[]) => void;
  maxFiles: number;
}

const SOURCE_LABEL: Record<StoreMediaImage["source"], string> = {
  product: "Product",
  variant: "Variant",
  collection: "Collection",
  blog: "Blog",
};

function mimeFromUrl(url: string): string {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * Lets the merchant reuse images that already live in their store (linked
 * product, collections, blog articles) as post media, without re-uploading.
 * The Shopify CDN URL is stored directly on the MediaAsset.
 */
export function StoreMediaPicker({
  productId,
  variantId,
  assets,
  onChange,
  maxFiles,
}: StoreMediaPickerProps) {
  const fetcher = useFetcher<{ images: StoreMediaImage[] }>();

  useEffect(() => {
    const qs = productId ? `?productId=${encodeURIComponent(productId)}` : "";
    fetcher.load(`/api/store-media${qs}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const loading = fetcher.state === "loading";
  const fetched = useMemo(() => fetcher.data?.images ?? [], [fetcher.data]);

  // The linked variant's own image is what the merchant most likely wants, so
  // it leads the grid. Everything else keeps the server's order.
  const images = useMemo(() => {
    if (!variantId) return fetched;
    const linked = fetched.filter((img) => img.variantId === variantId);
    if (linked.length === 0) return fetched;
    return [...linked, ...fetched.filter((img) => img.variantId !== variantId)];
  }, [fetched, variantId]);

  const atLimit = assets.length >= maxFiles;
  const chosenUrls = new Set(assets.map((a) => a.url));

  function addImage(img: StoreMediaImage) {
    if (atLimit || chosenUrls.has(img.url)) return;
    const asset: WizardMediaAsset = {
      id: crypto.randomUUID(),
      url: img.url,
      mimeType: mimeFromUrl(img.url),
      altText: img.altText ?? undefined,
    };
    onChange([...assets, asset]);
  }

  if (loading && images.length === 0) {
    return (
      <InlineStack gap="200" blockAlign="center">
        <Spinner size="small" accessibilityLabel="Loading store images" />
        <Text as="p" tone="subdued">Loading images from your store...</Text>
      </InlineStack>
    );
  }

  if (images.length === 0) {
    return (
      <Text as="p" tone="subdued">
        No store images found. Link a product or add images to your products, collections, or blog posts.
      </Text>
    );
  }

  return (
    <BlockStack gap="300">
      <Text as="p" variant="bodySm" tone="subdued">
        {atLimit
          ? "You have reached the media limit for this post type."
          : "Click an image to add it to your post."}
      </Text>
      <InlineStack gap="300" wrap>
        {images.map((img) => {
          const selected = chosenUrls.has(img.url);
          const isLinkedVariant = Boolean(variantId) && img.variantId === variantId;
          const label = img.variantTitle
            ? `${SOURCE_LABEL.variant}: ${img.variantTitle}`
            : SOURCE_LABEL[img.source];
          return (
            <BlockStack key={img.url} gap="100" inlineAlign="center">
              <Box
                borderWidth={selected || isLinkedVariant ? "050" : undefined}
                borderColor={
                  selected ? "border-emphasis" : isLinkedVariant ? "border-success" : undefined
                }
                borderRadius="200"
              >
                <button
                  type="button"
                  onClick={() => addImage(img)}
                  disabled={selected || atLimit}
                  style={{
                    padding: 0,
                    border: "none",
                    background: "transparent",
                    cursor: selected || atLimit ? "default" : "pointer",
                    opacity: selected ? 0.5 : 1,
                  }}
                  aria-label={selected ? "Already added" : `Add ${label} image`}
                >
                  <Thumbnail size="large" alt={img.altText ?? "Store image"} source={img.url} />
                </button>
              </Box>
              {isLinkedVariant && !selected ? (
                <Badge tone="success">Linked variant</Badge>
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  {selected ? "Added" : label}
                </Text>
              )}
            </BlockStack>
          );
        })}
      </InlineStack>
    </BlockStack>
  );
}
