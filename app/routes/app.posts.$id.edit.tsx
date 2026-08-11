import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Banner } from "@shopify/polaris";
import shopify from "../shopify.server.js";
import { getBrands } from "../services/brand.server.js";
import { getAccountsForBrand } from "../services/oauth.server.js";
import {
  getPost,
  updatePost,
  publishNow,
  reschedulePost,
  revertPostToDraft,
  isPostEditable,
  PostNotEditableError,
} from "../services/post.server.js";
import { isManualPlatform } from "../utils/platformConstraints.js";
import { PostWizard } from "../components/wizard/PostWizard.js";
import type {
  WizardState,
  Platform,
  PostType,
  PlatformOverride,
  WizardMediaAsset,
  LinkedProduct,
} from "../types/post.js";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;

  // getPost filters by { id, shop }, so a post owned by another shop returns null
  // and 404s here — a merchant can never load someone else's post into the editor.
  const post = await getPost(params.id!, shop);
  if (!post) throw new Response("Not Found", { status: 404 });

  // Once a post starts publishing (or is cancelled) it can no longer be edited;
  // send the merchant to the read-only detail page instead of a stale editor.
  if (!isPostEditable(post.status)) {
    return redirect(`/app/posts/${post.id}`);
  }

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

  // Rebuild the wizard state from the stored post so every step is prefilled.
  // Per-platform overrides are only carried when the row actually diverged from
  // the main content (custom text or extra settings), so saving does not clobber
  // a platform's custom caption with the base content.
  const platformOverrides: Partial<Record<Platform, PlatformOverride>> = {};
  for (const pp of post.platformPosts) {
    const override: PlatformOverride = {};
    if (pp.content != null) override.content = pp.content;
    if (pp.extraJson != null) {
      try {
        override.extra = JSON.parse(pp.extraJson) as Record<string, unknown>;
      } catch {
        // Ignore unparseable extras; the editor falls back to defaults.
      }
    }
    if (override.content !== undefined || override.extra !== undefined) {
      platformOverrides[pp.platform as Platform] = override;
    }
  }

  const mediaAssets: WizardMediaAsset[] = post.mediaAssets.map((a) => ({
    id: a.id,
    url: a.url,
    mimeType: a.mimeType,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
    durationSec: a.durationSec ?? undefined,
    sizeBytes: a.sizeBytes ?? undefined,
    altText: a.altText ?? undefined,
  }));

  const product: LinkedProduct | null =
    post.productId && post.productHandle && post.productTitle && post.productUrl
      ? {
          id: post.productId,
          handle: post.productHandle,
          title: post.productTitle,
          // Already carries ?variant=<id> when a variant was linked.
          url: post.productUrl,
          variantId: post.variantId,
          variantTitle: post.variantTitle,
        }
      : null;

  // Rebuild the target selection: rows with a socialAccountId map back to their
  // account chip; account-less rows for a manual platform (e.g. rednote) map to
  // a manual-platform checkbox. An account-less row for a non-manual platform is
  // an orphan (its account was disconnected) and is intentionally dropped so the
  // merchant re-picks an account before saving.
  const selectedAccountIds = post.platformPosts
    .map((pp) => pp.socialAccountId)
    .filter((id): id is string => id != null);
  const manualPlatforms = post.platformPosts
    .filter((pp) => pp.socialAccountId == null && isManualPlatform(pp.platform))
    .map((pp) => pp.platform as Platform);

  const wizardInitial: WizardState = {
    scheduledAt: post.scheduledAt ? new Date(post.scheduledAt).toISOString() : null,
    brandId: post.brandId,
    postType: post.postType as PostType,
    selectedAccountIds,
    manualPlatforms,
    mainContent: post.mainContent,
    mediaAssets,
    platformOverrides,
    product,
  };

  // Handed to the browser at request time (not bundled at build time) so the
  // Dropbox Chooser can be enabled by setting the key and restarting.
  return json({
    brands,
    shop,
    wizardInitial,
    postId: post.id,
    dropboxAppKey: process.env.DROPBOX_APP_KEY || null,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await shopify.authenticate.admin(request);
  const shop = session.shop;
  const postId = params.id!;

  const formData = await request.formData();
  const intent = formData.get("_intent") as "save-draft" | "schedule" | "publish-now";
  const stateJson = formData.get("state") as string;
  const wizard = JSON.parse(stateJson) as WizardState;

  try {
    // Apply the content/platform/media edits first, then settle scheduling.
    await updatePost(postId, shop, wizard);

    if (intent === "publish-now") {
      await publishNow(postId, shop);
    } else if (intent === "schedule" && wizard.scheduledAt) {
      // Re-run the full schedule flow so jitter and per-platform jobs recompute
      // (reschedulePost cancels the old jobs before scheduling fresh ones).
      await reschedulePost(postId, shop, new Date(wizard.scheduledAt));
    } else {
      // Save draft: cancel any queued jobs so a previously scheduled post does
      // not auto-publish while sitting as a draft.
      await revertPostToDraft(postId, shop);
    }

    return redirect(`/app/posts/${postId}`);
  } catch (e) {
    if (e instanceof PostNotEditableError) {
      return json(
        {
          error:
            "This post can no longer be edited. It may have already started publishing.",
        },
        { status: 409 },
      );
    }
    throw e;
  }
};

export default function EditPost() {
  const { brands, shop, wizardInitial, postId, dropboxAppKey } =
    useLoaderData<typeof loader>();

  return (
    <Page
      title="Edit Post"
      backAction={{ content: "Post", url: `/app/posts/${postId}` }}
    >
      <Layout>
        <Layout.Section>
          <Banner tone="info">
            Editing this post. Save it as a draft, schedule it, or publish it now.
            Rescheduling recomputes each platform{"'"}s send time.
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <PostWizard
              brands={brands}
              shop={shop}
              dropboxAppKey={dropboxAppKey}
              initial={wizardInitial}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
