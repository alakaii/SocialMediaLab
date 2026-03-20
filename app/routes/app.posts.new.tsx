import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getBrands } from "../services/brand.server.js";
import { getConnectedPlatforms } from "../services/oauth.server.js";
import { createPost, schedulePost } from "../services/post.server.js";
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
      connectedPlatforms: (await getConnectedPlatforms(b.id)) as Platform[],
    })),
  );

  return json({ brands });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("_intent") as "save-draft" | "schedule";
  const stateJson = formData.get("state") as string;
  const wizard = JSON.parse(stateJson) as WizardState;

  const post = await createPost(shop, wizard);

  if (intent === "schedule" && wizard.scheduledAt) {
    await schedulePost(post.id, new Date(wizard.scheduledAt));
  }

  return redirect(`/app/posts/${post.id}`);
};

export default function NewPost() {
  const { brands } = useLoaderData<typeof loader>();

  return (
    <Page
      title="New Post"
      backAction={{ content: "Posts", url: "/app/posts" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <PostWizard brands={brands} />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
