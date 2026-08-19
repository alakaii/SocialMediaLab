import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  InlineGrid,
  Button,
  DataTable,
  Badge,
  Banner,
  ProgressBar,
} from "@shopify/polaris";
import { useEffect, useState } from "react";
import shopify from "../shopify.server.js";
import { getUpcomingPosts } from "../services/post.server.js";
import { prisma } from "../db.server.js";
import { PostStatus } from "../types/post.js";
import { PLATFORM_CONSTRAINTS } from "../utils/platformConstraints.js";
import type { Platform } from "../types/post.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  const now = new Date();
  const sevenDaysAhead = new Date(now.getTime() + 7 * DAY_MS);
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

  const [
    upcomingPosts,
    scheduledCount,
    publishedCount,
    failedCount,
    brandCount,
    socialAccountCount,
    postCount,
    settings,
  ] = await Promise.all([
    getUpcomingPosts(shop, 7),
    prisma.post.count({
      where: { shop, status: PostStatus.Scheduled, scheduledAt: { gte: now, lte: sevenDaysAhead } },
    }),
    prisma.post.count({
      where: { shop, status: PostStatus.Published, publishedAt: { gte: sevenDaysAgo } },
    }),
    // Post has no failedAt column, so updatedAt is the closest signal for a recent failure (the status change touches it).
    prisma.post.count({
      where: { shop, status: PostStatus.Failed, updatedAt: { gte: sevenDaysAgo } },
    }),
    prisma.brand.count({ where: { shop } }),
    prisma.socialAccount.count({ where: { shop } }),
    prisma.post.count({ where: { shop } }),
    prisma.shopSettings.findUnique({ where: { shop } }),
  ]);

  const onboardingSteps = [
    {
      title: "Create a brand",
      description: "Set up the brand voice, logo, and timezone your posts go out under.",
      action: "Create a brand",
      url: "/app/brands/new",
      done: brandCount > 0,
    },
    {
      title: "Connect a social account",
      description: "Link the accounts Social Media Lab publishes to on your behalf.",
      action: "Connect an account",
      url: "/app/connections",
      done: socialAccountCount > 0,
    },
    {
      title: "Schedule your first post",
      description: "Write a post once and let the scheduler send it to every platform.",
      action: "Schedule a post",
      url: "/app/posts/new",
      done: postCount > 0,
    },
  ];

  const completedSteps = onboardingSteps.filter((step) => step.done).length;
  const showOnboarding = completedSteps < onboardingSteps.length && !settings?.onboardingDismissedAt;

  return json({
    upcomingPosts,
    scheduledCount,
    publishedCount,
    failedCount,
    onboardingSteps,
    completedSteps,
    showOnboarding,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  const dismissedAt = new Date();

  try {
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { onboardingDismissedAt: dismissedAt },
      create: { shop, onboardingDismissedAt: dismissedAt },
    });
  } catch (error) {
    console.error("[dashboard] failed to dismiss setup guide", error);
    return json({ error: "Could not dismiss the setup guide. Please try again." }, { status: 500 });
  }

  return json({ error: null });
};

export default function Dashboard() {
  const {
    upcomingPosts,
    scheduledCount,
    publishedCount,
    failedCount,
    onboardingSteps,
    completedSteps,
    showOnboarding,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [errorDismissed, setErrorDismissed] = useState(false);
  // Every action response is a fresh object, so a repeat failure after the
  // banner was dismissed shows the banner again.
  useEffect(() => setErrorDismissed(false), [actionData]);

  const isDismissing = navigation.state === "submitting";
  const totalSteps = onboardingSteps.length;
  const progress = totalSteps === 0 ? 100 : (completedSteps / totalSteps) * 100;
  const showError = Boolean(actionData?.error) && !errorDismissed;

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
        {showError && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={() => setErrorDismissed(true)}>
              {actionData?.error}
            </Banner>
          </Layout.Section>
        )}

        {showOnboarding && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">Set up Social Media Lab</Text>
                    <Text as="p" tone="subdued">
                      Three quick steps before your first post goes out.
                    </Text>
                  </BlockStack>
                  <Form method="post">
                    <Button submit variant="tertiary" loading={isDismissing}>Dismiss</Button>
                  </Form>
                </InlineStack>

                <BlockStack gap="200">
                  <ProgressBar progress={progress} size="small" tone="primary" />
                  <Text as="p" tone="subdued" variant="bodySm">
                    {completedSteps} of {totalSteps} complete
                  </Text>
                </BlockStack>

                <BlockStack gap="300">
                  {onboardingSteps.map((step) => (
                    <InlineStack key={step.title} align="space-between" blockAlign="center" gap="400" wrap={false}>
                      <InlineStack gap="300" blockAlign="center" wrap={false}>
                        {step.done ? (
                          <Badge tone="success" progress="complete">Done</Badge>
                        ) : (
                          <Badge progress="incomplete">To do</Badge>
                        )}
                        <BlockStack gap="050">
                          <Text
                            as="span"
                            fontWeight="medium"
                            tone={step.done ? "subdued" : undefined}
                            textDecorationLine={step.done ? "line-through" : undefined}
                          >
                            {step.title}
                          </Text>
                          {!step.done && (
                            <Text as="span" tone="subdued" variant="bodySm">{step.description}</Text>
                          )}
                        </BlockStack>
                      </InlineStack>
                      {!step.done && <Button url={step.url}>{step.action}</Button>}
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineGrid columns={3} gap="400">
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued">Scheduled (next 7 days)</Text>
                <Text as="h2" variant="heading2xl">{scheduledCount}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued">Published (last 7 days)</Text>
                <Text as="h2" variant="heading2xl">{publishedCount}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" tone="subdued">Failed (last 7 days)</Text>
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
