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
  Select,
  Checkbox,
} from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { prisma } from "../db.server.js";
import { getBrands } from "../services/brand.server.js";
import {
  getAccountsForShop,
  deleteSocialAccount,
  associateAccountWithBrand,
  disassociateFromBrand,
} from "../services/oauth.server.js";
import { PLATFORM_CONSTRAINTS, isManualPlatform } from "../utils/platformConstraints.js";
import { Platform } from "../types/post.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  const [accounts, rawBrands] = await Promise.all([
    getAccountsForShop(shop),
    getBrands(shop),
  ]);
  const brands = rawBrands.map((b) => ({ id: b.id, name: b.name }));

  return json({ accounts, brands });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_intent");

  if (intent === "disconnect") {
    // deleteSocialAccount is already scoped to the shop.
    await deleteSocialAccount(String(formData.get("accountId")), shop);
    return json({ ok: true });
  }

  if (intent === "associate" || intent === "disassociate") {
    const accountId = String(formData.get("accountId"));
    const brandId = String(formData.get("brandId"));
    // Verify both the account and the brand belong to this shop before changing
    // any association, so a merchant can never touch another shop's data.
    const [account, brand] = await Promise.all([
      prisma.socialAccount.findFirst({ where: { id: accountId, shop }, select: { id: true } }),
      prisma.brand.findFirst({ where: { id: brandId, shop }, select: { id: true } }),
    ]);
    if (account && brand) {
      if (intent === "associate") {
        await associateAccountWithBrand(accountId, brandId);
      } else {
        await disassociateFromBrand(accountId, brandId);
      }
    }
    return json({ ok: true });
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
  const { accounts, brands } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [blueskyBrand, setBlueskyBrand] = useState<{ id: string; name: string } | null>(null);

  // Connecting a new account always starts from a brand context; the new account
  // auto-associates with the chosen brand. Default to the first brand.
  const [connectBrandId, setConnectBrandId] = useState<string>(brands[0]?.id ?? "");
  const connectBrand = brands.find((b) => b.id === connectBrandId) ?? null;

  function toggleBrand(accountId: string, brandId: string, checked: boolean) {
    fetcher.submit(
      { _intent: checked ? "associate" : "disassociate", accountId, brandId },
      { method: "POST" },
    );
  }

  function disconnect(accountId: string) {
    fetcher.submit({ _intent: "disconnect", accountId }, { method: "POST" });
  }

  return (
    <Page title="Social Media Connections">
      <Layout>
        {/* Connected accounts (shop-level) */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Connected accounts</Text>
                <Text as="p" tone="subdued">
                  Accounts are connected once for your shop and can be shared with
                  any of your brands.
                </Text>
              </BlockStack>
              <Divider />

              {accounts.length === 0 ? (
                <Text as="p" tone="subdued">
                  No accounts connected yet. Connect one below.
                </Text>
              ) : (
                <BlockStack gap="400">
                  {accounts.map((account) => {
                    const c = PLATFORM_CONSTRAINTS[account.platform as Platform];
                    const associatedBrandIds = new Set(account.brands.map((b) => b.id));
                    return (
                      <Box
                        key={account.id}
                        padding="400"
                        borderColor="border"
                        borderWidth="025"
                        borderRadius="200"
                      >
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="300" blockAlign="center">
                              <Text as="span" variant="headingLg">{c?.icon}</Text>
                              <BlockStack gap="0">
                                <Text as="p" variant="bodyMd" fontWeight="semibold">
                                  {account.accountName ?? c?.label ?? account.platform}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {c?.label ?? account.platform}
                                </Text>
                              </BlockStack>
                            </InlineStack>
                            <Button
                              size="slim"
                              tone="critical"
                              onClick={() => disconnect(account.id)}
                            >
                              Disconnect
                            </Button>
                          </InlineStack>

                          <Divider />

                          <Text as="p" variant="bodySm" tone="subdued">
                            Available to these brands
                          </Text>
                          {brands.length === 0 ? (
                            <Text as="p" variant="bodySm" tone="subdued">
                              Add a brand to share this account with.
                            </Text>
                          ) : (
                            <InlineStack gap="400" wrap>
                              {brands.map((brand) => (
                                <Checkbox
                                  key={brand.id}
                                  label={brand.name}
                                  checked={associatedBrandIds.has(brand.id)}
                                  onChange={(checked) =>
                                    toggleBrand(account.id, brand.id, checked)
                                  }
                                />
                              ))}
                            </InlineStack>
                          )}
                        </BlockStack>
                      </Box>
                    );
                  })}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Connect a new account */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Connect a new account</Text>
                <Text as="p" tone="subdued">
                  Pick which brand to connect for. The new account is added to your
                  shop and shared with that brand; you can share it with more brands
                  above.
                </Text>
              </BlockStack>

              {brands.length === 0 ? (
                <BlockStack gap="200" inlineAlign="start">
                  <Text as="p" tone="subdued">Add a brand first to connect social accounts.</Text>
                  <Button url="/app/brands/new">Add Brand</Button>
                </BlockStack>
              ) : (
                <>
                  <Box maxWidth="320px">
                    <Select
                      label="Connect for brand"
                      options={brands.map((b) => ({ label: b.name, value: b.id }))}
                      value={connectBrandId}
                      onChange={setConnectBrandId}
                    />
                  </Box>

                  <Divider />

                  <InlineStack gap="300" wrap>
                    {ALL_PLATFORMS.map((platform) => {
                      const c = PLATFORM_CONSTRAINTS[platform];
                      const isManual = isManualPlatform(platform);
                      const oauthUrl = `/api/oauth/${platform}?brandId=${connectBrandId}`;

                      return (
                        <Box
                          key={platform}
                          padding="400"
                          background="bg-surface"
                          borderColor="border"
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
                              <Badge>Connect</Badge>
                            )}
                            {isManual ? (
                              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                                No connection needed. The app preps your post at the
                                scheduled time and you copy-paste it into the app.
                              </Text>
                            ) : platform === Platform.Bluesky ? (
                              <Button
                                size="slim"
                                variant="primary"
                                disabled={!connectBrand}
                                onClick={() => connectBrand && setBlueskyBrand(connectBrand)}
                              >
                                Connect
                              </Button>
                            ) : (
                              <Button
                                size="slim"
                                variant="primary"
                                url={oauthUrl}
                                disabled={!connectBrandId}
                              >
                                Connect
                              </Button>
                            )}
                          </BlockStack>
                        </Box>
                      );
                    })}
                  </InlineStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <BlueskyConnectModal brand={blueskyBrand} onClose={() => setBlueskyBrand(null)} />
    </Page>
  );
}
