import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Divider,
  List,
  Banner,
} from "@shopify/polaris";
import shopify from "../shopify.server.js";
import {
  MONTHLY_PLAN,
  MONTHLY_PLAN_AMOUNT,
  MONTHLY_PLAN_CURRENCY,
  MONTHLY_PLAN_TRIAL_DAYS,
  billingReturnUrl,
  isTestBilling,
} from "../billing.server.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await shopify.authenticate.admin(request);

  // This route is exempt from the gate in app.tsx, so check subscription state
  // here to decide between "subscribe" and "already subscribed".
  const { hasActivePayment } = await billing.check({
    plans: [MONTHLY_PLAN],
    isTest: isTestBilling(),
  });

  return json({
    hasActivePayment,
    planName: MONTHLY_PLAN,
    amount: MONTHLY_PLAN_AMOUNT,
    currency: MONTHLY_PLAN_CURRENCY,
    trialDays: MONTHLY_PLAN_TRIAL_DAYS,
    isTest: isTestBilling(),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await shopify.authenticate.admin(request);

  // billing.request never returns: it throws a redirect to Shopify's charge
  // confirmation page, breaking out of the admin iframe on its own.
  await billing.request({
    plan: MONTHLY_PLAN,
    isTest: isTestBilling(),
    returnUrl: billingReturnUrl(request, session.shop),
  });

  return null;
};

const PLAN_FEATURES = [
  "Multi-brand scheduling from one calendar",
  "Publishing to Meta (Facebook and Instagram) and Bluesky",
  "Product-linked posts pulled straight from your catalog",
  "Hashtag memory that reuses what works per brand",
];

export default function BillingPlan() {
  const { hasActivePayment, amount, currency, trialDays, isTest } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  const price = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);

  return (
    <Page title="Plan" narrowWidth>
      <Layout>
        {isTest && (
          <Layout.Section>
            <Banner tone="info">
              <p>
                Test mode: subscriptions created here are not charged to a real
                payment method.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingLg">
                    Social Media Lab
                  </Text>
                  {hasActivePayment ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="info">{`${trialDays}-day free trial`}</Badge>
                  )}
                </InlineStack>
                <InlineStack gap="150" blockAlign="baseline">
                  <Text as="p" variant="heading2xl">
                    {price}
                  </Text>
                  <Text as="p" tone="subdued">
                    per month
                  </Text>
                </InlineStack>
                <Text as="p" tone="subdued">
                  {`Billed every 30 days. Your first ${trialDays} days are free, and you can cancel any time from your Shopify admin.`}
                </Text>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  What you get
                </Text>
                <List type="bullet">
                  {PLAN_FEATURES.map((feature) => (
                    <List.Item key={feature}>{feature}</List.Item>
                  ))}
                </List>
              </BlockStack>

              <Divider />

              {hasActivePayment ? (
                <BlockStack gap="300" inlineAlign="start">
                  <Text as="p">
                    You are subscribed. Everything in the app is unlocked.
                  </Text>
                  <Button variant="primary" url="/app">
                    Back to dashboard
                  </Button>
                </BlockStack>
              ) : (
                <Form method="post">
                  <BlockStack gap="200" inlineAlign="start">
                    <Button
                      variant="primary"
                      submit
                      loading={submitting}
                      disabled={submitting}
                    >
                      {`Start ${trialDays}-day free trial`}
                    </Button>
                    <Text as="p" variant="bodySm" tone="subdued">
                      You will be taken to Shopify to approve the subscription.
                    </Text>
                  </BlockStack>
                </Form>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
