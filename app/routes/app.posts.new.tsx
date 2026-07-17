import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Banner } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getBrands } from "../services/brand.server.js";
import { getAccountsForBrand } from "../services/oauth.server.js";
import { createPost, schedulePost, publishNow } from "../services/post.server.js";
import { PostWizard } from "../components/wizard/PostWizard.js";
import type { WizardState } from "../types/post.js";
import type { Platform } from "../types/post.js";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  const rawBrands = await getBrands(shop);
  const brands = await Promise.all(
    rawBrands.map(async (b) => ({
      id: b.id,
      name: b.name,
      logoUrl: b.logoUrl,
      timezone: b.timezone,
      accounts: (await getAccountsForBrand(b.id)).map((a) => ({
        id: a.id,
        platform: a.platform as Platform,
        accountName: a.accountName,
      })),
    })),
  );

  // Holiday prefill: /app/posts/new?date=YYYY-MM-DD&holiday=Name starts a draft
  // scheduled for that day at noon so the merchant can plan around the occasion.
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const holiday = url.searchParams.get("holiday");
  const prefillScheduledAt =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00.000Z` : null;

  return json({ brands, prefillScheduledAt, holiday, shop });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("_intent") as "save-draft" | "schedule" | "publish-now";
  const stateJson = formData.get("state") as string;
  const wizard = JSON.parse(stateJson) as WizardState;

  const post = await createPost(shop, wizard);

  if (intent === "schedule" && wizard.scheduledAt) {
    await schedulePost(post.id, new Date(wizard.scheduledAt));
  } else if (intent === "publish-now") {
    await publishNow(post.id, shop);
  }

  return redirect(`/app/posts/${post.id}`);
};

export default function NewPost() {
  const { brands, prefillScheduledAt, holiday, shop } = useLoaderData<typeof loader>();

  const initial = prefillScheduledAt ? { scheduledAt: prefillScheduledAt } : undefined;

  return (
    <Page
      title="New Post"
      backAction={{ content: "Posts", url: "/app/posts" }}
    >
      <Layout>
        {holiday && prefillScheduledAt && (
          <Layout.Section>
            <Banner tone="info">
              {`Planning a post for ${holiday}. The schedule is set to ${new Date(prefillScheduledAt).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} at 12:00 PM, adjust it as you like.`}
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card>
            <PostWizard brands={brands} shop={shop} initial={initial} />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
