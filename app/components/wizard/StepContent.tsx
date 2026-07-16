import { useState } from "react";
import { BlockStack, Card, Text, TextField, Divider, Tabs } from "@shopify/polaris";
import { MediaUploader } from "../media/MediaUploader.js";
import { StoreMediaPicker } from "../media/StoreMediaPicker.js";
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

export function StepContent({
  postType,
  mainContent,
  mediaAssets,
  product,
  shop,
  onContentChange,
  onMediaChange,
  onProductChange,
}: StepContentProps) {
  const isTextOnly = postType === PostType.Text;
  // Store media is images only, so the "From your store" tab is offered for
  // image posts (product/collection/blog images are still images).
  const allowsImages = postType === PostType.Image;
  const [mediaTab, setMediaTab] = useState(0);

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
            {allowsImages ? (
              <>
                <Tabs
                  tabs={[
                    { id: "upload", content: "Upload" },
                    { id: "store", content: "From your store" },
                  ]}
                  selected={mediaTab}
                  onSelect={setMediaTab}
                  fitted
                />
                {mediaTab === 0 ? (
                  <MediaUploader
                    assets={mediaAssets}
                    onChange={onMediaChange}
                    accept={ACCEPTS[postType]}
                    maxFiles={MAX_FILES[postType]}
                  />
                ) : (
                  <StoreMediaPicker
                    productId={product?.id ?? null}
                    assets={mediaAssets}
                    onChange={onMediaChange}
                    maxFiles={MAX_FILES[postType]}
                  />
                )}
              </>
            ) : (
              <MediaUploader
                assets={mediaAssets}
                onChange={onMediaChange}
                accept={ACCEPTS[postType]}
                maxFiles={MAX_FILES[postType]}
              />
            )}
          </>
        )}
      </BlockStack>
    </Card>
  );
}
