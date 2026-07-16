import { useEffect } from "react";
import { BlockStack, InlineStack, Text, Tag } from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";

interface HashtagSuggestion {
  hashtag: string;
  usageCount: number;
}

interface HashtagSuggestionsProps {
  productId: string;
  onPick: (hashtag: string) => void;
}

/**
 * Shows the linked product's most-used hashtags as clickable chips. Clicking a
 * chip appends that hashtag to the caption. Ranked by usage on the server.
 */
export function HashtagSuggestions({ productId, onPick }: HashtagSuggestionsProps) {
  const fetcher = useFetcher<{ hashtags: HashtagSuggestion[] }>();

  useEffect(() => {
    fetcher.load(`/api/hashtags?productId=${encodeURIComponent(productId)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const hashtags = fetcher.data?.hashtags ?? [];
  if (hashtags.length === 0) return null;

  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodySm" tone="subdued">
        Hashtags you have used for this product
      </Text>
      <InlineStack gap="200" wrap>
        {hashtags.map((h) => (
          <Tag key={h.hashtag} onClick={() => onPick(h.hashtag)}>
            {h.hashtag}
          </Tag>
        ))}
      </InlineStack>
    </BlockStack>
  );
}
