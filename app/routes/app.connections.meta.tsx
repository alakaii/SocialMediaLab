import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigation, Form } from "@remix-run/react";
import axios from "axios";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Box,
  Badge,
} from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { prisma } from "../db.server.js";
import {
  upsertOAuthToken,
  metaSelectionCookie,
} from "../services/oauth.server.js";
import type { MetaSelectionState } from "../services/oauth.server.js";
import { GRAPH_BASE } from "../adapters/metaGraph.js";

interface IgAccount {
  id: string;
  username?: string;
}

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: IgAccount;
}

async function readSelection(
  request: Request,
): Promise<MetaSelectionState | null> {
  return (await metaSelectionCookie.parse(
    request.headers.get("Cookie"),
  )) as MetaSelectionState | null;
}

async function fetchPages(userToken: string): Promise<MetaPage[]> {
  const res = await axios.get(`${GRAPH_BASE}/me/accounts`, {
    params: {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      access_token: userToken,
    },
  });
  return (res.data.data ?? []) as MetaPage[];
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook Page",
  instagram_feed: "Instagram Feed",
  instagram_reels: "Instagram Reels",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);

  const stored = await readSelection(request);
  if (!stored) {
    // No selection in progress (expired or already completed).
    throw redirect("/app/connections");
  }
  const { brandId, platform, userToken } = stored;

  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.shop !== session.shop) {
    throw new Response("Brand not found", { status: 404 });
  }

  const isInstagram = platform !== "facebook";
  const allPages = await fetchPages(userToken);
  const pages = (isInstagram
    ? allPages.filter((p) => p.instagram_business_account)
    : allPages
  ).map((p) => ({
    id: p.id,
    name: p.name,
    igUsername: p.instagram_business_account?.username ?? null,
  }));

  return json({
    brandName: brand.name,
    platform,
    platformLabel: PLATFORM_LABELS[platform] ?? platform,
    isInstagram,
    hasAnyPages: allPages.length > 0,
    pages,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);

  const stored = await readSelection(request);
  if (!stored) {
    throw redirect("/app/connections");
  }
  const { brandId, platform, userToken } = stored;

  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand || brand.shop !== session.shop) {
    throw new Response("Brand not found", { status: 404 });
  }

  const formData = await request.formData();
  const pageId = formData.get("pageId") as string | null;
  if (!pageId) throw new Response("Missing page", { status: 400 });

  // Re-fetch the pages with the user token so the page access token and IG
  // linkage come from Meta rather than from the client.
  const pages = await fetchPages(userToken);
  const page = pages.find((p) => p.id === pageId);
  if (!page) {
    throw new Response("Selected page not found", { status: 400 });
  }

  if (platform === "facebook") {
    // Page access tokens from a long-lived user token do not expire, so leave
    // expiresAt undefined.
    await upsertOAuthToken({
      brandId,
      platform,
      accessToken: page.access_token,
      accountId: page.id,
      accountName: page.name,
    });
  } else {
    const ig = page.instagram_business_account;
    if (!ig) {
      throw new Response(
        "Selected page has no linked Instagram business account",
        { status: 400 },
      );
    }
    await upsertOAuthToken({
      brandId,
      platform,
      accessToken: page.access_token,
      accountId: ig.id,
      accountName: ig.username ?? page.name,
      tokenSecret: page.id,
    });
  }

  return redirect("/app/connections", {
    headers: {
      "Set-Cookie": await metaSelectionCookie.serialize("", { maxAge: 0 }),
    },
  });
};

export default function MetaPageSelection() {
  const { brandName, platformLabel, isInstagram, hasAnyPages, pages } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  return (
    <Page
      title={`Choose a Page for ${platformLabel}`}
      subtitle={`Connecting ${platformLabel} for ${brandName}`}
      backAction={{ content: "Connections", url: "/app/connections" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {!hasAnyPages && (
                <Banner tone="warning" title="No Facebook Pages found">
                  <p>
                    We could not find any Facebook Pages you manage. Create a
                    Facebook Page, then start the connection again. Instagram
                    publishing also requires a Facebook Page.
                  </p>
                </Banner>
              )}

              {hasAnyPages && isInstagram && pages.length === 0 && (
                <Banner
                  tone="warning"
                  title="No Instagram business account linked"
                >
                  <p>
                    None of your Facebook Pages have a linked Instagram account.
                    Your Instagram account must be a business account linked to a
                    Facebook Page. Link them in Instagram settings, then start
                    the connection again.
                  </p>
                </Banner>
              )}

              {pages.length > 0 && (
                <>
                  <Text as="p" variant="bodyMd">
                    {isInstagram
                      ? "Pick the Facebook Page whose linked Instagram account should publish."
                      : "Pick the Facebook Page to publish to."}
                  </Text>
                  <BlockStack gap="300">
                    {pages.map((p) => (
                      <Box
                        key={p.id}
                        padding="400"
                        borderColor="border"
                        borderWidth="025"
                        borderRadius="200"
                      >
                        <InlineStack align="space-between" blockAlign="center" gap="400">
                          <BlockStack gap="100">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {p.name}
                            </Text>
                            {isInstagram && p.igUsername && (
                              <Badge tone="info">{`@${p.igUsername}`}</Badge>
                            )}
                          </BlockStack>
                          <Form method="post">
                            <input type="hidden" name="pageId" value={p.id} />
                            <Button
                              variant="primary"
                              submit
                              loading={submitting}
                              disabled={submitting}
                            >
                              Connect
                            </Button>
                          </Form>
                        </InlineStack>
                      </Box>
                    ))}
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
