import { useMemo, useState } from "react";
import { BlockStack, Card, Text, TextField, Divider, Tabs } from "@shopify/polaris";
import { MediaUploader } from "../media/MediaUploader.js";
import { StoreMediaPicker } from "../media/StoreMediaPicker.js";
import { CloudMediaPicker } from "../media/CloudMediaPicker.js";
import { ProductLinkField } from "./ProductLinkField.js";
import { HashtagSuggestions } from "./HashtagSuggestions.js";
import { PostType } from "../../types/post.js";
import type { WizardMediaAsset, LinkedProduct } from "../../types/post.js";

interface StepContentProps {
  postType: PostType;
  mainContent: string;
  mediaAssets: WizardMediaAsset[];
  product: LinkedProduct | null;
  shop: string;
  /** Null when DROPBOX_APP_KEY is not configured; disables the Dropbox button. */
  dropboxAppKey: string | null;
  onContentChange: (content: string) => void;
  onMediaChange: (assets: WizardMediaAsset[]) => void;
  onProductChange: (product: LinkedProduct | null) => void;
}

const ACCEPTS: Record<PostType, string> = {
  [PostType.Text]: "",
  [PostType.Image]: "image/*",
  [PostType.ShortsVideo]: "video/*",
  [PostType.Video]: "video/*",
};

const MAX_FILES: Record<PostType, number> = {
  [PostType.Text]: 0,
  [PostType.Image]: 10,
  [PostType.ShortsVideo]: 1,
  [PostType.Video]: 1,
};

// What the cloud picker offers, so a video post cannot pull in a JPEG.
const CLOUD_EXTENSIONS: Record<PostType, string[]> = {
  [PostType.Text]: [],
  [PostType.Image]: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  [PostType.ShortsVideo]: [".mp4", ".mov"],
  [PostType.Video]: [".mp4", ".mov"],
};

export function StepContent({
  postType,
  mainContent,
  mediaAssets,
  product,
  shop,
  dropboxAppKey,
  onContentChange,
  onMediaChange,
  onProductChange,
}: StepContentProps) {
  const isTextOnly = postType === PostType.Text;
  // Store media is images only, so the "From your store" tab is offered for
  // image posts (product/collection/blog images are still images). Cloud import
  // handles video too, so it is offered for every media post type.
  const allowsImages = postType === PostType.Image;
  const [mediaTab, setMediaTab] = useState(0);

  const mediaTabs = useMemo(() => {
    const tabs = [{ id: "upload", content: "Upload" }];
    if (allowsImages) tabs.push({ id: "store", content: "From your store" });
    tabs.push({ id: "cloud", content: "From cloud" });
    return tabs;
  }, [allowsImages]);

  // The tab set shrinks when the merchant goes back and switches post type, so
  // clamp rather than render an empty panel.
  const selectedMediaTab = Math.min(mediaTab, mediaTabs.length - 1);
  const activeMediaTab = mediaTabs[selectedMediaTab].id;

  function appendToContent(text: string) {
    onContentChange(mainContent ? `${mainContent.trimEnd()} ${text}` : text);
  }

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">Write your content</Text>
        <Text as="p" tone="subdued">
          This is your base content. You{"'"}ll fine-tune it per platform in the next step.
        </Text>

        <ProductLinkField
          product={product}
          shop={shop}
          onChange={onProductChange}
          onInsertLink={() => product && appendToContent(product.url)}
        />

        <Divider />

        <TextField
          label="Main content"
          multiline={6}
          value={mainContent}
          onChange={onContentChange}
          autoComplete="off"
          placeholder={
            postType === PostType.Text
              ? "Write your post..."
              : "Write a caption or description..."
          }
          helpText={`${mainContent.length} characters`}
        />

        {product && (
          <HashtagSuggestions
            productId={product.id}
            onPick={(hashtag) => appendToContent(hashtag)}
          />
        )}

        {!isTextOnly && (
          <>
            <Divider />
            <Text as="h3" variant="headingSm">Media</Text>
            <Tabs
              tabs={mediaTabs}
              selected={selectedMediaTab}
              onSelect={setMediaTab}
              fitted
            />
            {activeMediaTab === "upload" && (
              <MediaUploader
                assets={mediaAssets}
                onChange={onMediaChange}
                accept={ACCEPTS[postType]}
                maxFiles={MAX_FILES[postType]}
              />
            )}
            {activeMediaTab === "store" && (
              <StoreMediaPicker
                productId={product?.id ?? null}
                variantId={product?.variantId ?? null}
                assets={mediaAssets}
                onChange={onMediaChange}
                maxFiles={MAX_FILES[postType]}
              />
            )}
            {activeMediaTab === "cloud" && (
              <CloudMediaPicker
                assets={mediaAssets}
                onChange={onMediaChange}
                maxFiles={MAX_FILES[postType]}
                dropboxAppKey={dropboxAppKey}
                extensions={CLOUD_EXTENSIONS[postType]}
              />
            )}
          </>
        )}
      </BlockStack>
    </Card>
  );
}
