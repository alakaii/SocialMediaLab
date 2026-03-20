import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, ResourceList, ResourceItem, Text, InlineStack, BlockStack, Button, Avatar, Badge } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getBrands, deleteBrand } from "../services/brand.server.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const brands = await getBrands(session.shop);
  return json({ brands });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_intent");
  const brandId = formData.get("brandId") as string;

  if (intent === "delete") {
    await deleteBrand(brandId, session.shop);
  }

  return json({ ok: true });
};

export default function BrandsList() {
  const { brands } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <Page
      title="Brands"
      primaryAction={<Button variant="primary" url="/app/brands/new">Add Brand</Button>}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <ResourceList
              items={brands}
              renderItem={(brand) => (
                <ResourceItem
                  id={brand.id}
                  url={`/app/brands/${brand.id}`}
                  name={brand.name}
                  media={<Avatar size="md" name={brand.name} source={brand.logoUrl ?? undefined} />}
                  verticalAlignment="center"
                  shortcutActions={[
                    {
                      content: "Delete",
                      destructive: true,
                      onAction: () => {
                        fetcher.submit(
                          { _intent: "delete", brandId: brand.id },
                          { method: "POST" },
                        );
                      },
                    },
                  ]}
                >
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">{brand.name}</Text>
                    <InlineStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">{brand.timezone}</Text>
                      {brand.oauthTokens.map((t) => (
                        <Badge key={t.platform} size="small">{t.platform}</Badge>
                      ))}
                    </InlineStack>
                  </BlockStack>
                </ResourceItem>
              )}
              emptyState={
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" tone="subdued">No brands yet.</Text>
                  <Button url="/app/brands/new">Add your first brand</Button>
                </BlockStack>
              }
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
