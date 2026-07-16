import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, ResourceList, ResourceItem, Text, InlineStack, BlockStack, Button, Badge, Select } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getPosts } from "../services/post.server.js";
import { getShopSettings, updateHolidayCountry } from "../services/settings.server.js";
import { getUpcomingHolidays, getCountryOptions } from "../services/holidays.server.js";
import { StatusBadge } from "../components/shared/StatusBadge.js";
import { PLATFORM_CONSTRAINTS } from "../utils/platformConstraints.js";
import type { Platform } from "../types/post.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  const [posts, settings] = await Promise.all([
    getPosts(shop),
    getShopSettings(shop),
  ]);

  const holidays = getUpcomingHolidays(settings.holidayCountry, 60);
  const countryOptions = getCountryOptions();

  return json({
    posts,
    holidayCountry: settings.holidayCountry,
    holidays,
    countryOptions,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("_intent") === "update-country") {
    await updateHolidayCountry(session.shop, String(formData.get("country") ?? "US"));
    return json({ ok: true });
  }

  return json({ ok: false });
};

export default function PostsList() {
  const { posts, holidayCountry, holidays, countryOptions } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

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
                            {`${PLATFORM_CONSTRAINTS[pp.platform as Platform]?.icon ?? ""} ${PLATFORM_CONSTRAINTS[pp.platform as Platform]?.label ?? ""}`}
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

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Holiday country</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Used to suggest upcoming holidays to plan posts around.
                </Text>
                <Select
                  label="Country"
                  labelHidden
                  options={countryOptions}
                  value={holidayCountry}
                  onChange={(value) =>
                    fetcher.submit(
                      { _intent: "update-country", country: value },
                      { method: "POST" },
                    )
                  }
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Upcoming holidays</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Next 60 days. Pick one to start a post scheduled for that day.
                </Text>
                {holidays.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No public holidays in the next 60 days.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    {holidays.map((h) => (
                      <InlineStack key={`${h.date}-${h.name}`} align="space-between" blockAlign="center" gap="200">
                        <BlockStack gap="0">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{h.name}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">{h.label}</Text>
                        </BlockStack>
                        <Button
                          size="slim"
                          url={`/app/posts/new?date=${encodeURIComponent(h.date)}&holiday=${encodeURIComponent(h.name)}`}
                        >
                          Plan post
                        </Button>
                      </InlineStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
