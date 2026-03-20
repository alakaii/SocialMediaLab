import { BlockStack, Card, Text, TextField, Divider } from "@shopify/polaris";
import { MediaUploader } from "../media/MediaUploader.js";
import { PostType } from "../../types/post.js";
import type { WizardMediaAsset } from "../../types/post.js";

interface StepContentProps {
  postType: PostType;
  mainContent: string;
  mediaAssets: WizardMediaAsset[];
  onContentChange: (content: string) => void;
  onMediaChange: (assets: WizardMediaAsset[]) => void;
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

export function StepContent({ postType, mainContent, mediaAssets, onContentChange, onMediaChange }: StepContentProps) {
  const isTextOnly = postType === PostType.Text;

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">Write your content</Text>
        <Text as="p" tone="subdued">
          This is your base content. You{"'"}ll fine-tune it per platform in the next step.
        </Text>
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

        {!isTextOnly && (
          <>
            <Divider />
            <Text as="h3" variant="headingSm">Media</Text>
            <MediaUploader
              assets={mediaAssets}
              onChange={onMediaChange}
              accept={ACCEPTS[postType]}
              maxFiles={MAX_FILES[postType]}
            />
          </>
        )}
      </BlockStack>
    </Card>
  );
}
