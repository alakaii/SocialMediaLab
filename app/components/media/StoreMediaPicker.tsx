import { useEffect } from "react";
import { BlockStack, InlineStack, Text, Thumbnail, Spinner, Box } from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";
import type { WizardMediaAsset } from "../../types/post.js";

interface StoreMediaImage {
  url: string;
  altText: string | null;
  source: "product" | "collection" | "blog";
}

interface StoreMediaPickerProps {
  productId: string | null;
  assets: WizardMediaAsset[];
  onChange: (assets: WizardMediaAsset[]) => void;
  maxFiles: number;
}

const SOURCE_LABEL: Record<StoreMediaImage["source"], string> = {
  product: "Product",
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
export function StoreMediaPicker({ productId, assets, onChange, maxFiles }: StoreMediaPickerProps) {
  const fetcher = useFetcher<{ images: StoreMediaImage[] }>();

  useEffect(() => {
    const qs = productId ? `?productId=${encodeURIComponent(productId)}` : "";
    fetcher.load(`/api/store-media${qs}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const loading = fetcher.state === "loading";
  const images = fetcher.data?.images ?? [];
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
          return (
            <BlockStack key={img.url} gap="100" inlineAlign="center">
              <Box
                borderWidth={selected ? "050" : undefined}
                borderColor={selected ? "border-emphasis" : undefined}
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
                  aria-label={selected ? "Already added" : `Add ${SOURCE_LABEL[img.source]} image`}
                >
                  <Thumbnail size="large" alt={img.altText ?? "Store image"} source={img.url} />
                </button>
              </Box>
              <Text as="p" variant="bodySm" tone="subdued">
                {selected ? "Added" : SOURCE_LABEL[img.source]}
              </Text>
            </BlockStack>
          );
        })}
      </InlineStack>
    </BlockStack>
  );
}
