import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, SerializeFrom } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineStack,
  Button,
  Divider,
  Badge,
  Banner,
  TextField,
  Box,
  Link,
} from "@shopify/polaris";
import shopify from "../shopify.server.js";
import {
  getPost,
  cancelPost,
  markPlatformPosted,
  skipPlatform,
} from "../services/post.server.js";
import { StatusBadge } from "../components/shared/StatusBadge.js";
import {
  PLATFORM_CONSTRAINTS,
  isManualPlatform,
} from "../utils/platformConstraints.js";
import { PostStatus, PlatformPostStatus } from "../types/post.js";
import type { Platform } from "../types/post.js";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const post = await getPost(params.id!, session.shop);
  if (!post) throw new Response("Not Found", { status: 404 });
  return json({ post });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_intent") as string;

  if (intent === "cancel") {
    await cancelPost(params.id!, session.shop);
    return json({ ok: true });
  }

  if (intent === "delete") {
    await cancelPost(params.id!, session.shop);
    return redirect("/app/posts");
  }

  if (intent === "mark-posted") {
    await markPlatformPosted(
      params.id!,
      formData.get("postPlatformId") as string,
      session.shop,
    );
    return json({ ok: true });
  }

  if (intent === "skip-manual") {
    await skipPlatform(
      params.id!,
      formData.get("postPlatformId") as string,
      session.shop,
    );
    return json({ ok: true });
  }

  return json({ ok: false });
};

// Pull hashtags out of the caption so they can be shown and copied on their own.
// Unicode-aware so CJK hashtags (common on RedNote) are matched too.
function extractHashtags(text: string): string[] {
  return text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
}

type LoadedPost = SerializeFrom<typeof loader>["post"];
type LoadedPlatformPost = LoadedPost["platformPosts"][number];

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the text stays visible for manual selection.
    }
  };

  return (
    <BlockStack gap="200">
      <TextField
        label={label}
        value={value}
        readOnly
        multiline={4}
        autoComplete="off"
      />
      <InlineStack>
        <Button onClick={copy}>{copied ? "Copied" : `Copy ${label.toLowerCase()}`}</Button>
      </InlineStack>
    </BlockStack>
  );
}

function ManualPostCard({
  post,
  pp,
}: {
  post: LoadedPost;
  pp: LoadedPlatformPost;
}) {
  const fetcher = useFetcher();
  const c = PLATFORM_CONSTRAINTS[pp.platform as Platform];
  const caption = pp.content ?? post.mainContent;
  const hashtags = extractHashtags(caption);
  const submitting = fetcher.state !== "idle";

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="headingLg">{c?.icon}</Text>
            <Text as="h2" variant="headingMd">
              {`Ready to post on ${c?.label ?? pp.platform}`}
            </Text>
          </InlineStack>
          <Badge tone="attention">Action needed</Badge>
        </InlineStack>

        <Text as="p" tone="subdued">
          This platform has no posting API, so post it yourself. Copy the caption
          below, save the media, and paste them into the app. Then mark it as
          posted so we can update the status.
        </Text>

        <CopyField label="Caption" value={caption} />

        {hashtags.length > 0 && (
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">Hashtags</Text>
            <InlineStack gap="100" wrap>
              {hashtags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </InlineStack>
          </BlockStack>
        )}

        {post.mediaAssets.length > 0 && (
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">Media</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Open each item in a new tab to save it, then upload it when you post.
            </Text>
            <InlineStack gap="300" wrap>
              {post.mediaAssets.map((asset) => {
                const isVideo = asset.mimeType.startsWith("video");
                return (
                  <BlockStack key={asset.id} gap="100" inlineAlign="center">
                    <Box
                      borderColor="border"
                      borderWidth="025"
                      borderRadius="200"
                      overflowX="hidden"
                      overflowY="hidden"
                      minWidth="96px"
                    >
                      {isVideo ? (
                        <Box padding="600" background="bg-surface-secondary">
                          <Text as="span" variant="headingLg">🎬</Text>
                        </Box>
                      ) : (
                        <img
                          src={asset.url}
                          alt={asset.altText ?? ""}
                          style={{
                            width: 96,
                            height: 96,
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      )}
                    </Box>
                    <Link url={asset.url} external>
                      Open in new tab
                    </Link>
                  </BlockStack>
                );
              })}
            </InlineStack>
          </BlockStack>
        )}

        <Divider />

        <InlineStack gap="200">
          <Button
            variant="primary"
            loading={submitting}
            onClick={() =>
              fetcher.submit(
                { _intent: "mark-posted", postPlatformId: pp.id },
                { method: "POST" },
              )
            }
          >
            Mark as posted
          </Button>
          <Button
            disabled={submitting}
            onClick={() =>
              fetcher.submit(
                { _intent: "skip-manual", postPlatformId: pp.id },
                { method: "POST" },
              )
            }
          >
            Skip
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function platformStatusBadge(status: string) {
  if (status === PlatformPostStatus.Published) return <Badge tone="success">Published</Badge>;
  if (status === PlatformPostStatus.Failed) return <Badge tone="critical">Failed</Badge>;
  if (status === PlatformPostStatus.Skipped) return <Badge>Skipped</Badge>;
  if (status === PlatformPostStatus.AwaitingManual) return <Badge tone="attention">Action needed</Badge>;
  if (status === PlatformPostStatus.Pending) return <Badge tone="info">Pending</Badge>;
  return <Badge>{status}</Badge>;
}

export default function PostDetail() {
  const { post } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const canCancel = post.status === PostStatus.Scheduled;
  const awaitingManual = post.platformPosts.filter(
    (pp) => pp.status === PlatformPostStatus.AwaitingManual,
  );

  return (
    <Page
      title="Post Detail"
      backAction={{ content: "Posts", url: "/app/posts" }}
      primaryAction={
        canCancel
          ? {
              content: "Cancel Post",
              destructive: true,
              onAction: () => {
                fetcher.submit({ _intent: "cancel" }, { method: "POST" });
              },
            }
          : undefined
      }
    >
      <Layout>
        {awaitingManual.length > 0 && (
          <Layout.Section>
            <BlockStack gap="400">
              {awaitingManual.map((pp) => (
                <ManualPostCard key={pp.id} post={post} pp={pp} />
              ))}
            </BlockStack>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Post Overview</Text>
                <StatusBadge status={post.status} />
              </InlineStack>

              <BlockStack gap="200">
                <Text as="p" tone="subdued">Brand</Text>
                <Text as="p" variant="bodyMd">{post.brand?.name}</Text>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="p" tone="subdued">Scheduled</Text>
                <Text as="p" variant="bodyMd">
                  {post.scheduledAt ? new Date(post.scheduledAt).toLocaleString() : "Not scheduled"}
                </Text>
              </BlockStack>

              <BlockStack gap="200">
                <Text as="p" tone="subdued">Main content</Text>
                <Text as="p" variant="bodyMd">{post.mainContent}</Text>
              </BlockStack>

              {post.productTitle && (
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">Linked product</Text>
                  <Text as="p" variant="bodyMd">{post.productTitle}</Text>
                  {post.productUrl && (
                    <Text as="p" variant="bodySm" tone="subdued">{post.productUrl}</Text>
                  )}
                </BlockStack>
              )}

              <Divider />

              <Text as="h3" variant="headingSm">Per-Platform Status</Text>

              {post.platformPosts.map((pp) => {
                const c = PLATFORM_CONSTRAINTS[pp.platform as Platform];
                return (
                  <Card key={pp.platform}>
                    <InlineStack align="space-between" blockAlign="start">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="headingMd">{c?.icon}</Text>
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{c?.label ?? pp.platform}</Text>
                          {pp.status === PlatformPostStatus.AwaitingManual && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              Waiting for you to post it manually (see the card above).
                            </Text>
                          )}
                          {pp.status === "pending" && pp.publishAt && (
                            <Text as="p" variant="bodySm" tone="subdued">
                              {`Fires ~${new Date(pp.publishAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                            </Text>
                          )}
                          {pp.content && (
                            <Text as="p" variant="bodySm" tone="subdued">{pp.content.slice(0, 100)}</Text>
                          )}
                          {pp.errorMessage && (
                            <Banner tone="critical">{pp.errorMessage}</Banner>
                          )}
                        </BlockStack>
                      </InlineStack>
                      {platformStatusBadge(pp.status)}
                    </InlineStack>
                  </Card>
                );
              })}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
