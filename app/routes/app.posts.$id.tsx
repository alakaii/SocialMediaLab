import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, InlineStack, Button, Divider, Badge, Banner } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getPost, cancelPost, reschedulePost } from "../services/post.server.js";
import { StatusBadge } from "../components/shared/StatusBadge.js";
import { PLATFORM_CONSTRAINTS } from "../utils/platformConstraints.js";
import { PostStatus } from "../types/post.js";
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

  return json({ ok: false });
};

export default function PostDetail() {
  const { post } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const canCancel = post.status === PostStatus.Scheduled;

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
                          {pp.content && (
                            <Text as="p" variant="bodySm" tone="subdued">{pp.content.slice(0, 100)}</Text>
                          )}
                          {pp.errorMessage && (
                            <Banner tone="critical">{pp.errorMessage}</Banner>
                          )}
                        </BlockStack>
                      </InlineStack>
                      <Badge tone={
                        pp.status === "published" ? "success" :
                        pp.status === "failed" ? "critical" :
                        pp.status === "pending" ? "info" : undefined
                      }>
                        {pp.status}
                      </Badge>
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
