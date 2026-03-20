import { BlockStack, Card, Text, InlineGrid, Box } from "@shopify/polaris";
import { PostType } from "../../types/post.js";

const POST_TYPES = [
  { type: PostType.Text, icon: "✍️", label: "Text", description: "Words only — great for Twitter, LinkedIn, Facebook" },
  { type: PostType.Image, icon: "🖼️", label: "Image", description: "Photo or graphic — works on all visual platforms" },
  { type: PostType.ShortsVideo, icon: "📱", label: "Short Video", description: "Vertical video ≤60–90s — Reels, TikTok, Shorts" },
  { type: PostType.Video, icon: "🎥", label: "Video", description: "Longer video for YouTube, Facebook, TikTok" },
];

interface StepPostTypeProps {
  selected: PostType | null;
  onChange: (type: PostType) => void;
}

export function StepPostType({ selected, onChange }: StepPostTypeProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">What type of post?</Text>
        <InlineGrid columns={2} gap="300">
          {POST_TYPES.map(({ type, icon, label, description }) => {
            const isSelected = selected === type;
            return (
              <Box
                key={type}
                padding="400"
                background={isSelected ? "bg-surface-selected" : "bg-surface"}
                borderColor={isSelected ? "border-emphasis" : "border"}
                borderWidth="025"
                borderRadius="200"
                as="button"
                onClick={() => onChange(type)}
              >
                <BlockStack gap="200">
                  <Text as="p" variant="headingLg">{icon}</Text>
                  <Text as="p" variant="headingMd" fontWeight="semibold">{label}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{description}</Text>
                </BlockStack>
              </Box>
            );
          })}
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}
