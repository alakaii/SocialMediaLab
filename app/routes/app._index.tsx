import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, InlineGrid, Button, DataTable, Badge } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getUpcomingPosts } from "../services/post.server.js";
import { prisma } from "../db.server.js";
import { PostStatus } from "../types/post.js";
import { PLATFORM_CONSTRAINTS } from "../utils/platformConstraints.js";
import type { Platform } from "../types/post.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  const [upcomingPosts, scheduledCount, failedCount, publishedCount] = await Promise.all([
    getUpcomingPosts(shop, 7),
    prisma.post.count({ where: { shop, status: PostStatus.Scheduled } }),
    prisma.post.count({ where: { shop, status: PostStatus.Failed } }),
    prisma.post.count({ where: { shop, status: PostStatus.Published } }),
  ]);

  return json({ upcomingPosts, scheduledCount, failedCount, publishedCount });
};

export default function Dashboard() {
  const { upcomingPosts, scheduledCount, failedCount, publishedCount } = useLoaderData<typeof loader>();

  const rows = upcomingPosts.map((p) => [
    p.brand?.name ?? "—",
    p.platformPosts.map((pp) => PLATFORM_CONSTRAINTS[pp.platform as Platform]?.icon ?? pp.platform).join(" "),
    p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : "—",
    <Badge tone="info" key={p.id}>Scheduled</Badge>,
  ]);

  return (
    <Page
      title="Social Media Lab"
      primaryAction={
        <Button variant="primary" url="/app/posts/new">New Post</Button>
      }
    >
      <Layout>
        <Layout.Section>
          <InlineGrid columns={3} gap="400">
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued">Scheduled</Text>
                <Text as="h2" variant="heading2xl">{scheduledCount}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued">Published (all time)</Text>
                <Text as="h2" variant="heading2xl">{publishedCount}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued">Failed</Text>
                <Text as="h2" variant="heading2xl" tone={failedCount > 0 ? "critical" : undefined}>
                  {failedCount}
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Upcoming Posts (next 7 days)</Text>
              {upcomingPosts.length === 0 ? (
                <BlockStack gap="300" inlineAlign="center">
                  <Text as="p" tone="subdued">No posts scheduled in the next 7 days.</Text>
                  <Button url="/app/posts/new">Create your first post</Button>
                </BlockStack>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Brand", "Platforms", "Scheduled At", "Status"]}
                  rows={rows}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
