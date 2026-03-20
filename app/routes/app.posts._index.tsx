import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { Page, Layout, Card, ResourceList, ResourceItem, Text, InlineStack, BlockStack, Button, Badge } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getPosts } from "../services/post.server.js";
import { StatusBadge } from "../components/shared/StatusBadge.js";
import { PLATFORM_CONSTRAINTS } from "../utils/platformConstraints.js";
import type { Platform } from "../types/post.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const posts = await getPosts(session.shop);
  return json({ posts });
};

export default function PostsList() {
  const { posts } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Posts"
      primaryAction={<Button variant="primary" url="/app/posts/new">New Post</Button>}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <ResourceList
              items={posts}
              renderItem={(post) => (
                <ResourceItem
                  id={post.id}
                  url={`/app/posts/${post.id}`}
                  name={post.mainContent.slice(0, 60)}
                  verticalAlignment="center"
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {post.mainContent.slice(0, 80)}{post.mainContent.length > 80 ? "…" : ""}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {post.brand?.name} · {post.scheduledAt ? new Date(post.scheduledAt).toLocaleString() : "No schedule"}
                      </Text>
                      <InlineStack gap="100">
                        {post.platformPosts.map((pp) => (
                          <Badge key={pp.platform} size="small">
                            {PLATFORM_CONSTRAINTS[pp.platform as Platform]?.icon} {PLATFORM_CONSTRAINTS[pp.platform as Platform]?.label}
                          </Badge>
                        ))}
                      </InlineStack>
                    </BlockStack>
                    <StatusBadge status={post.status} />
                  </InlineStack>
                </ResourceItem>
              )}
              emptyState={
                <BlockStack gap="300" inlineAlign="center">
                  <Text as="p" tone="subdued">No posts yet.</Text>
                  <Button url="/app/posts/new">Create your first post</Button>
                </BlockStack>
              }
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
