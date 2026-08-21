import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useCallback, useState } from "react";
import { useLoaderData } from "@remix-run/react";
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
import { prisma } from "../db.server.js";
import { TIER_NONE, hostedPlanPageUrl, resolveTier } from "../billing.server.js";
import { BRAND_PRICE_USD } from "../services/usage-billing.server.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await shopify.authenticate.admin(request);

  // Shopify appends plan_handle when it sends the merchant back through a
  // plan's welcome link, which is the one moment the cached tier is guaranteed
  // stale, so that read skips the throttle.
  const url = new URL(request.url);
  const returningFromCheckout = url.searchParams.has("plan_handle");

  const { tier, planHandle, subscription } = await resolveTier({
    shop: session.shop,
    admin,
    force: returningFromCheckout,
  });

  // An unset SHOPIFY_APP_HANDLE throws rather than rendering a dead button, so
  // the page still loads and says what is wrong.
  let planPageUrl: string | null = null;
  let configError: string | null = null;
  try {
    planPageUrl = hostedPlanPageUrl(session.shop);
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
    console.error("[billing] hosted plan page URL unavailable", err);
  }

  // What the merchant is actually billed for. The plan's base price is $0 and
  // the entire charge comes from the per-brand meter, so the brand count is the
  // only number on this page a merchant can act on.
  const brandCount = await prisma.brand.count({ where: { shop: session.shop } });

  return json({
    // Computed here because TIER_NONE lives in the server-only billing module;
    // referencing it from the component would pull server code into the client
    // bundle and fail the build.
    subscribed: tier !== TIER_NONE,
    planHandle,
    planName: subscription?.planName ?? null,
    priceAmount: subscription?.priceAmount ?? null,
    priceCurrency: subscription?.priceCurrency ?? null,
    planPageUrl,
    configError,
    brandCount,
    // Same reason as TIER_NONE: the rate lives in a server-only module.
    pricePerBrand: BRAND_PRICE_USD,
  });
};

const PLAN_FEATURES = [
  "Multi-brand scheduling from one calendar",
  "Publishing to Meta (Facebook and Instagram) and Bluesky",
  "Product-linked posts pulled straight from your catalog",
  "Hashtag memory that reuses what works per brand",
];

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function BillingPlan() {
  const {
    subscribed,
    planHandle,
    planName,
    priceAmount,
    priceCurrency,
    planPageUrl,
    configError,
    brandCount,
    pricePerBrand,
  } = useLoaderData<typeof loader>();

  const [errorDismissed, setErrorDismissed] = useState(false);
  const dismissError = useCallback(() => setErrorDismissed(true), []);

  // Only render a price the Partner API actually reported, and only when it is
  // a real charge. The base price on this plan is $0, which the contract may
  // report as 0 or omit entirely; either way "$0.00" in the price slot would
  // read as "this app is free" when the meter is where the money is.
  const basePrice =
    priceAmount !== null && priceAmount > 0 && priceCurrency
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: priceCurrency,
        }).format(priceAmount)
      : null;

  const perBrand = `${USD.format(pricePerBrand)} per brand per month`;
  const brandsLabel = `${brandCount} ${brandCount === 1 ? "brand" : "brands"}`;
  const estimate = USD.format(brandCount * pricePerBrand);

  // Fall back to the handle when the contract carried no display name, so the
  // card always names something real.
  const displayName = planName ?? planHandle ?? "Social Media Lab";

  return (
    <Page title="Plan" narrowWidth>
      <Layout>
        {configError && !errorDismissed && (
          <Layout.Section>
            <Banner tone="critical" onDismiss={dismissError}>
              <p>
                The plan page cannot be opened right now because the app is
                missing its plan configuration. Please contact support.
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
                    {subscribed ? displayName : "Social Media Lab"}
                  </Text>
                  {subscribed && <Badge tone="success">Active</Badge>}
                </InlineStack>

                {subscribed ? (
                  <BlockStack gap="150">
                    <Text as="p" variant="heading2xl">
                      Free to install
                    </Text>
                    <Text as="p" variant="headingMd">
                      {perBrand}
                    </Text>
                    <Text as="p" tone="subdued">
                      {`You have ${brandsLabel}, about ${estimate} per month.`}
                    </Text>
                    {basePrice && (
                      <Text as="p" tone="subdued">
                        {`Your plan also carries a base charge of ${basePrice}.`}
                      </Text>
                    )}
                    <Text as="p" tone="subdued">
                      Your subscription is active and everything in the app is
                      unlocked. Plan changes and cancellation happen in your
                      Shopify admin.
                    </Text>
                  </BlockStack>
                ) : (
                  <Text as="p" tone="subdued">
                    Social Media Lab needs an active subscription. Choose a plan
                    in your Shopify admin to unlock scheduling, publishing, and
                    your connected accounts.
                  </Text>
                )}
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

              <BlockStack gap="200" inlineAlign="start">
                {/*
                  This has to be a real anchor with target="_top": Shopify's
                  hosted plan page refuses to be iframed, so the link must break
                  out of the admin iframe, which a client-side navigation cannot
                  do. Polaris routes `url` through the app's link component
                  (Remix's Link), and React Router renders a cross-origin
                  absolute URL as a plain <a> with the native click handler, so
                  this is a full document navigation rather than a route change.
                */}
                <Button
                  variant="primary"
                  url={planPageUrl ?? undefined}
                  target="_top"
                  disabled={!planPageUrl}
                >
                  {subscribed ? "Change plan" : "Choose a plan"}
                </Button>
                <Text as="p" variant="bodySm" tone="subdued">
                  Plans open in your Shopify admin, outside this window.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
