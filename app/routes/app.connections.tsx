import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  InlineStack,
  Button,
  Badge,
  Divider,
  Box,
  Modal,
  TextField,
  Banner,
  Link,
} from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getBrands } from "../services/brand.server.js";
import { deleteOAuthToken, getConnectedPlatforms } from "../services/oauth.server.js";
import { PLATFORM_CONSTRAINTS, isManualPlatform } from "../utils/platformConstraints.js";
import { Platform } from "../types/post.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;
  const baseUrl = new URL(request.url).origin;

  const brands = await getBrands(shop);
  const brandsWithConnections = await Promise.all(
    brands.map(async (brand) => ({
      id: brand.id,
      name: brand.name,
      connectedPlatforms: await getConnectedPlatforms(brand.id),
    })),
  );

  return json({ brands: brandsWithConnections, baseUrl });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "disconnect") {
    const brandId = formData.get("brandId") as string;
    const platform = formData.get("platform") as string;
    await deleteOAuthToken(brandId, platform);
  }

  return json({ ok: true });
};

const ALL_PLATFORMS = Object.values(Platform);

interface BlueskyConnectResponse {
  ok: boolean;
  error?: string;
}

function BlueskyConnectModal({
  brand,
  onClose,
}: {
  brand: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<BlueskyConnectResponse>();
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");

  const open = brand !== null;
  const submitting = fetcher.state !== "idle";
  const error = fetcher.data && fetcher.data.ok === false ? fetcher.data.error : undefined;

  // Reset the form each time the modal is opened for a brand.
  useEffect(() => {
    if (open) {
      setHandle("");
      setAppPassword("");
    }
  }, [open, brand?.id]);

  // Close the modal once a connection succeeds.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok === true) {
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  const submit = () => {
    if (!brand) return;
    fetcher.submit(
      { brandId: brand.id, handle, appPassword },
      { method: "POST", action: "/api/bluesky/connect" },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect Bluesky"
      primaryAction={{
        content: "Connect",
        onAction: submit,
        loading: submitting,
        disabled: submitting || !handle.trim() || !appPassword.trim(),
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose, disabled: submitting }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {error && (
            <Banner tone="critical">
              <p>{error}</p>
            </Banner>
          )}
          <Text as="p" variant="bodyMd">
            Bluesky connects with an app password instead of a login. Create one
            under Bluesky Settings, then App Passwords, and paste it below. Your
            main account password is never used.
          </Text>
          <TextField
            label="Handle"
            value={handle}
            onChange={setHandle}
            autoComplete="off"
            placeholder="name.bsky.social"
            helpText="Your Bluesky handle, for example name.bsky.social."
            disabled={submitting}
          />
          <TextField
            label="App password"
            value={appPassword}
            onChange={setAppPassword}
            type="password"
            autoComplete="off"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            disabled={submitting}
          />
          <Text as="p" variant="bodySm" tone="subdued">
            Need one? Open{" "}
            <Link url="https://bsky.app/settings/app-passwords" external>
              Bluesky app passwords
            </Link>{" "}
            to create an app password.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

export default function Connections() {
  const { brands } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [blueskyBrand, setBlueskyBrand] = useState<{ id: string; name: string } | null>(null);

  return (
    <Page title="Social Media Connections">
      <Layout>
        {brands.map((brand) => (
          <Layout.Section key={brand.id}>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{brand.name}</Text>
                <Divider />
                <InlineStack gap="300" wrap>
                  {ALL_PLATFORMS.map((platform) => {
                    const c = PLATFORM_CONSTRAINTS[platform];
                    const isManual = isManualPlatform(platform);
                    const isConnected = brand.connectedPlatforms.includes(platform);
                    const oauthUrl = `/api/oauth/${platform}?brandId=${brand.id}`;

                    return (
                      <Box
                        key={platform}
                        padding="400"
                        background={isConnected ? "bg-surface-success" : "bg-surface"}
                        borderColor={isConnected ? "border-success" : "border"}
                        borderWidth="025"
                        borderRadius="200"
                        minWidth="180px"
                      >
                        <BlockStack gap="300" inlineAlign="center">
                          <Text as="p" variant="headingXl">{c.icon}</Text>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">{c.label}</Text>
                          {isManual ? (
                            <Badge tone="info">Manual posting</Badge>
                          ) : (
                            <Badge tone={isConnected ? "success" : undefined}>
                              {isConnected ? "Connected" : "Not connected"}
                            </Badge>
                          )}
                          {isManual ? (
                            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                              No connection needed. The app preps your post at the
                              scheduled time and you copy-paste it into the app.
                            </Text>
                          ) : isConnected ? (
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => {
                                fetcher.submit(
                                  { _intent: "disconnect", brandId: brand.id, platform },
                                  { method: "POST" },
                                );
                              }}
                            >
                              Disconnect
                            </Button>
                          ) : platform === Platform.Bluesky ? (
                            <Button
                              size="slim"
                              variant="primary"
                              onClick={() => setBlueskyBrand({ id: brand.id, name: brand.name })}
                            >
                              Connect
                            </Button>
                          ) : (
                            <Button size="slim" variant="primary" url={oauthUrl}>
                              Connect
                            </Button>
                          )}
                        </BlockStack>
                      </Box>
                    );
                  })}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        ))}

        {brands.length === 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200" inlineAlign="center">
                <Text as="p" tone="subdued">Add a brand first to connect social accounts.</Text>
                <Button url="/app/brands/new">Add Brand</Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>

      <BlueskyConnectModal brand={blueskyBrand} onClose={() => setBlueskyBrand(null)} />
    </Page>
  );
}
