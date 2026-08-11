import { Avatar, Badge, BlockStack, Banner, Box, InlineStack, Text } from "@shopify/polaris";
import type { Platform, LinkedProduct, WizardMediaAsset } from "../../types/post.js";
import { PLATFORM_CONSTRAINTS } from "../../utils/platformConstraints.js";
import { domainFromUrl } from "../../utils/product.js";
import { CharacterCounter } from "../shared/CharacterCounter.js";

interface PostPreviewProps {
  platform: Platform;
  brandName: string;
  brandLogoUrl?: string | null;
  // Shown when exactly one account of this platform is targeted, so the
  // merchant can see which profile the post lands on.
  accountName?: string | null;
  content: string;
  // Platforms with a title field (YouTube Shorts, RedNote) show it above the caption.
  title?: string;
  mediaAssets: WizardMediaAsset[];
  product: LinkedProduct | null;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * A rough rendering of how the post will read on one platform. It is deliberately
 * a plain Polaris card rather than a clone of each network's chrome: enough to
 * judge the caption, the lead image, and the link, and nothing that goes stale
 * every time a network restyles itself.
 */
export function PostPreview({
  platform,
  brandName,
  brandLogoUrl,
  accountName,
  content,
  title,
  mediaAssets,
  product,
}: PostPreviewProps) {
  const constraints = PLATFORM_CONSTRAINTS[platform];

  const images = mediaAssets.filter((a) => a.mimeType.startsWith("image/"));
  const videos = mediaAssets.filter((a) => a.mimeType.startsWith("video/"));
  const firstImage = images[0];
  const firstVideo = videos[0];

  // A link preview stands in for the missing media when the post links a product
  // and has no image of its own, which is how most networks render a bare link.
  const showLinkCard = !firstImage && !firstVideo && product !== null;

  const overBy =
    constraints.maxChars !== null && content.length > constraints.maxChars
      ? content.length - constraints.maxChars
      : 0;

  return (
    <BlockStack gap="300">
      <Box maxWidth="480px">
        <Box
          background="bg-surface"
          borderColor="border"
          borderWidth="025"
          borderRadius="300"
          padding="400"
        >
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" gap="300">
              <InlineStack gap="300" blockAlign="center">
                <Avatar size="md" name={brandName} source={brandLogoUrl ?? undefined} />
                <BlockStack gap="050">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{brandName}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {accountName ? `${accountName} · ${constraints.label}` : constraints.label}
                  </Text>
                </BlockStack>
              </InlineStack>
              <Text as="span" variant="headingMd">{constraints.icon}</Text>
            </InlineStack>

            {title && (
              <Text as="h4" variant="headingSm">{title}</Text>
            )}

            {content.trim().length > 0 ? (
              <Text as="p" variant="bodyMd">
                <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{content}</span>
              </Text>
            ) : (
              <Text as="p" variant="bodyMd" tone="subdued">
                Your caption will show up here.
              </Text>
            )}

            {firstImage && (
              <BlockStack gap="150">
                <img
                  src={firstImage.url}
                  alt={firstImage.altText ?? "Post image"}
                  style={{
                    display: "block",
                    width: "100%",
                    maxHeight: "320px",
                    objectFit: "cover",
                    borderRadius: "8px",
                  }}
                />
                {images.length > 1 && (
                  <InlineStack align="end">
                    <Badge>{`1 of ${images.length} images`}</Badge>
                  </InlineStack>
                )}
              </BlockStack>
            )}

            {!firstImage && firstVideo && (
              <Box
                background="bg-surface-secondary"
                borderColor="border"
                borderWidth="025"
                borderRadius="200"
                padding="500"
              >
                <InlineStack align="center" gap="200" blockAlign="center">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {firstVideo.durationSec
                      ? `Video · ${formatDuration(firstVideo.durationSec)}`
                      : "Video"}
                  </Text>
                </InlineStack>
              </Box>
            )}

            {showLinkCard && product && (
              <Box
                background="bg-surface-secondary"
                borderColor="border"
                borderWidth="025"
                borderRadius="200"
                padding="300"
              >
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {domainFromUrl(product.url)}
                  </Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{product.title}</Text>
                  {product.variantTitle && (
                    <Text as="p" variant="bodySm" tone="subdued">{product.variantTitle}</Text>
                  )}
                </BlockStack>
              </Box>
            )}

            <InlineStack align="space-between" blockAlign="center">
              <CharacterCounter current={content.length} max={constraints.maxChars} />
              {images.length > 0 && (
                <Text as="span" variant="bodySm" tone="subdued">
                  {images.length} image{images.length !== 1 ? "s" : ""}
                </Text>
              )}
            </InlineStack>
          </BlockStack>
        </Box>
      </Box>

      {overBy > 0 && (
        <Banner tone="warning">
          {`This caption is ${overBy} character${overBy !== 1 ? "s" : ""} over the ${constraints.maxChars} character limit for ${constraints.label}. Shorten it below, or it may be cut off.`}
        </Banner>
      )}

      <Text as="p" variant="bodySm" tone="subdued">
        Social networks tweak their designs all the time. This is a best estimate
        of how your post will look.
      </Text>
    </BlockStack>
  );
}
