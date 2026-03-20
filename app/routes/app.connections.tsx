import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, BlockStack, Text, InlineStack, Button, Badge, Divider, Box } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getBrands } from "../services/brand.server.js";
import { deleteOAuthToken, getConnectedPlatforms } from "../services/oauth.server.js";
import { PLATFORM_CONSTRAINTS } from "../utils/platformConstraints.js";
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

export default function Connections() {
  const { brands, baseUrl } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

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
                          <Badge tone={isConnected ? "success" : undefined}>
                            {isConnected ? "Connected" : "Not connected"}
                          </Badge>
                          {isConnected ? (
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
                          ) : platform === Platform.RedNote ? (
                            <Button size="slim" url={`/app/brands/${brand.id}`}>
                              Set API Key
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
    </Page>
  );
}
