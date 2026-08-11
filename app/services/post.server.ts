import { prisma } from "../db.server.js";
import { enqueuePlatformPost, removeJob } from "../queue.server.js";
import { jitteredPublishAt } from "../utils/jitter.js";
import { recordProductHashtags } from "./hashtag.server.js";
import type { WizardState, Platform } from "../types/post.js";
import { PostStatus, PlatformPostStatus } from "../types/post.js";

/**
 * A PostPlatform row derived from a wizard state, before it is persisted.
 * socialAccountId is null for manual platforms (e.g. rednote).
 */
interface DesiredPlatformRow {
  platform: string;
  socialAccountId: string | null;
  content: string | null;
  extraJson: string | null;
}

/**
 * Build the PostPlatform rows a wizard state implies: one row per selected
 * account (socialAccountId + the account's platform) and one per manual platform
 * (socialAccountId null). Selected accounts are validated against the shop so a
 * merchant can never attach another shop's account. Duplicate accounts and
 * duplicate manual platforms are collapsed here so the per-post uniqueness rules
 * hold: at most one row per account, and at most one manual row per platform.
 * Per-platform content/settings overrides are keyed by platform and applied to
 * every account row of that platform.
 */
async function resolvePlatformRows(
  shop: string,
  wizard: WizardState,
): Promise<DesiredPlatformRow[]> {
  const accountIds = [...new Set(wizard.selectedAccountIds)];
  const accounts = accountIds.length
    ? await prisma.socialAccount.findMany({
        where: { id: { in: accountIds }, shop },
        select: { id: true, platform: true },
      })
    : [];

  const rows: DesiredPlatformRow[] = accounts.map((a) => {
    const override = wizard.platformOverrides[a.platform as Platform];
    return {
      platform: a.platform,
      socialAccountId: a.id,
      content: override?.content ?? null,
      extraJson: override?.extra ? JSON.stringify(override.extra) : null,
    };
  });

  for (const platform of [...new Set(wizard.manualPlatforms)]) {
    const override = wizard.platformOverrides[platform];
    rows.push({
      platform,
      socialAccountId: null,
      content: override?.content ?? null,
      extraJson: override?.extra ? JSON.stringify(override.extra) : null,
    });
  }

  return rows;
}

/**
 * Stable key for reconciling a platform row: account rows are keyed by account
 * id (so a post can target two accounts on the same platform), manual rows by
 * their platform (at most one per platform).
 */
function platformRowKey(row: {
  socialAccountId: string | null;
  platform: string;
}): string {
  return row.socialAccountId
    ? `acct:${row.socialAccountId}`
    : `manual:${row.platform}`;
}

// Editability predicate lives in the client-safe types module so route
// components can gate Edit / Publish-now UI without importing this server-only
// service. Re-exported here for existing server-side call sites.
import { EDITABLE_POST_STATUSES, isPostEditable } from "../types/post.js";
export { EDITABLE_POST_STATUSES, isPostEditable };

/**
 * Thrown when an edit or publish-now is attempted on a post that is no longer
 * editable (e.g. a queued job fired between page load and submit). Routes catch
 * this and show a friendly banner instead of crashing.
 */
export class PostNotEditableError extends Error {
  constructor() {
    super("This post can no longer be edited.");
    this.name = "PostNotEditableError";
  }
}

export async function getPosts(shop: string, filters?: { status?: string; brandId?: string }) {
  return prisma.post.findMany({
    where: {
      shop,
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.brandId ? { brandId: filters.brandId } : {}),
    },
    include: {
      brand: { select: { name: true, logoUrl: true } },
      platformPosts: true,
      mediaAssets: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { scheduledAt: "desc" },
  });
}

export async function getPost(id: string, shop: string) {
  return prisma.post.findFirst({
    where: { id, shop },
    include: {
      brand: true,
      platformPosts: {
        include: {
          // Only the display name of the target account, never its tokens.
          socialAccount: { select: { accountName: true, accountId: true } },
        },
      },
      mediaAssets: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function createPost(shop: string, wizard: WizardState) {
  const product = wizard.product ?? null;
  const platformRows = await resolvePlatformRows(shop, wizard);
  const post = await prisma.post.create({
    data: {
      shop,
      brandId: wizard.brandId!,
      postType: wizard.postType!,
      status: PostStatus.Draft,
      scheduledAt: wizard.scheduledAt ? new Date(wizard.scheduledAt) : null,
      mainContent: wizard.mainContent,
      productId: product?.id ?? null,
      productHandle: product?.handle ?? null,
      productTitle: product?.title ?? null,
      productUrl: product?.url ?? null,
      variantId: product?.variantId ?? null,
      variantTitle: product?.variantTitle ?? null,
      platformPosts: {
        create: platformRows.map((r) => ({
          platform: r.platform,
          socialAccountId: r.socialAccountId,
          content: r.content,
          extraJson: r.extraJson,
        })),
      },
      mediaAssets: {
        create: wizard.mediaAssets.map((asset, i) => ({
          url: asset.url,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height,
          durationSec: asset.durationSec,
          sizeBytes: asset.sizeBytes,
          altText: asset.altText,
          sortOrder: i,
        })),
      },
    },
  });

  // Remember which hashtags were used for this product so we can suggest them
  // next time. Non-fatal: never block post creation on hashtag bookkeeping.
  if (product?.id) {
    try {
      await recordProductHashtags(shop, product.id, wizard.mainContent);
    } catch {
      // ignore
    }
  }

  return post;
}

export async function schedulePost(postId: string, scheduledAt: Date) {
  const now = new Date();

  // Give each platform its own jittered fire time around the merchant-chosen
  // scheduledAt, so a multi-platform post does not post everywhere at the exact
  // same formulaic second. Keep Post.scheduledAt as the user's chosen time.
  const platformPosts = await prisma.postPlatform.findMany({
    where: { postId },
    select: { id: true, platform: true, socialAccountId: true },
  });

  // One BullMQ job per platform, each delayed to that platform's own jittered
  // publishAt. The job id is stored on the PostPlatform row so we can cancel or
  // reschedule it later. Post.bullJobId is no longer used for scheduled posts
  // (nulled below) but the column is kept for backward compatibility.
  for (const pp of platformPosts) {
    const publishAt = jitteredPublishAt(scheduledAt, now);
    const job = await enqueuePlatformPost(
      {
        postId,
        postPlatformId: pp.id,
        platform: pp.platform,
        socialAccountId: pp.socialAccountId,
      },
      publishAt,
    );
    await prisma.postPlatform.update({
      where: { id: pp.id },
      data: {
        publishAt,
        status: PlatformPostStatus.Pending,
        bullJobId: job.id?.toString() ?? null,
      },
    });
  }

  await prisma.post.update({
    where: { id: postId },
    data: {
      status: PostStatus.Scheduled,
      scheduledAt,
      bullJobId: null,
    },
  });
}

export async function createAndSchedulePost(shop: string, wizard: WizardState) {
  const post = await createPost(shop, wizard);
  if (wizard.scheduledAt) {
    await schedulePost(post.id, new Date(wizard.scheduledAt));
  }
  return post;
}

/**
 * Publish a post immediately. Every still-pending platform row is enqueued to
 * fire right now, with NO jitter (publish-now is exempt by design: the merchant
 * asked for it to go out now, so we do not stagger it). Manual platforms (e.g.
 * RedNote) land in awaiting_manual as soon as the worker picks them up, which is
 * the correct immediate outcome for a platform with no posting API.
 *
 * Only rows still in "pending" are touched, which keeps this idempotent against
 * double-submits and against a post whose queued jobs already started: a row the
 * worker already moved to publishing/published/awaiting_manual is left alone.
 * Any previously queued (jittered) jobs are removed first so nothing double-fires.
 *
 * Post.status is set the same way schedulePost sets it (Scheduled) so the worker
 * performs its scheduled -> publishing transition; scheduledAt is set to now.
 * Guards ownership and editability: throws PostNotEditableError if the post has
 * left an editable state.
 */
export async function publishNow(postId: string, shop: string) {
  const post = await prisma.post.findFirst({
    where: { id: postId, shop },
    select: { id: true, status: true, bullJobId: true },
  });
  if (!post) throw new Error("Post not found");
  if (!isPostEditable(post.status)) throw new PostNotEditableError();

  const now = new Date();

  // Cancel any jobs already queued from a prior schedule so we never double-fire.
  await removeAllJobsForPost(postId, post.bullJobId);

  // Only rows still pending get a fresh immediate job. Rows the worker already
  // advanced (publishing/published/failed/awaiting_manual/skipped) are left as-is.
  const pending = await prisma.postPlatform.findMany({
    where: { postId, status: PlatformPostStatus.Pending },
    select: { id: true, platform: true, socialAccountId: true },
  });

  for (const pp of pending) {
    const job = await enqueuePlatformPost(
      {
        postId,
        postPlatformId: pp.id,
        platform: pp.platform,
        socialAccountId: pp.socialAccountId,
      },
      now, // no jitter: fire immediately
    );
    await prisma.postPlatform.update({
      where: { id: pp.id },
      data: {
        publishAt: now,
        status: PlatformPostStatus.Pending,
        bullJobId: job.id?.toString() ?? null,
      },
    });
  }

  await prisma.post.update({
    where: { id: postId },
    data: {
      status: PostStatus.Scheduled,
      scheduledAt: now,
      bullJobId: null,
    },
  });

  return postId;
}

/**
 * Return a post to draft: cancel any queued jobs and clear per-platform
 * scheduling so nothing auto-publishes. Used when a merchant edits a scheduled
 * post and saves it as a draft again (or saves a draft that stays a draft).
 * Only pending rows are reset; an editable post should not have non-pending
 * rows, but if a job fired mid-edit those rows are left untouched.
 * Guards ownership and editability -> PostNotEditableError.
 */
export async function revertPostToDraft(postId: string, shop: string) {
  const post = await prisma.post.findFirst({
    where: { id: postId, shop },
    select: { id: true, status: true, bullJobId: true },
  });
  if (!post) throw new Error("Post not found");
  if (!isPostEditable(post.status)) throw new PostNotEditableError();

  await removeAllJobsForPost(postId, post.bullJobId);

  await prisma.postPlatform.updateMany({
    where: { postId, status: PlatformPostStatus.Pending },
    data: { publishAt: null, bullJobId: null },
  });

  await prisma.post.update({
    where: { id: postId },
    data: { status: PostStatus.Draft, bullJobId: null },
  });

  return postId;
}

/**
 * Apply a wizard edit to an existing post, reconciling its platform and media
 * children to match the new wizard state. Only updates the content of the post;
 * scheduling/jobs are handled by the caller (schedule / draft / publish-now).
 *
 * Platform rows are reconciled by platform key so an unchanged platform keeps its
 * row (and thus its status, publishAt, and queued job) rather than being deleted
 * and recreated. Removed platforms have their queued job cancelled before the row
 * is deleted so it cannot fire against a missing row. Media assets are fully
 * replaced to match the wizard.
 *
 * Guards ownership and editability up front: throws PostNotEditableError if the
 * post has left an editable state (e.g. a queued job fired mid-edit).
 */
export async function updatePost(postId: string, shop: string, wizard: WizardState) {
  const existing = await prisma.post.findFirst({
    where: { id: postId, shop },
    include: {
      platformPosts: {
        select: {
          id: true,
          platform: true,
          socialAccountId: true,
          bullJobId: true,
        },
      },
    },
  });
  if (!existing) throw new Error("Post not found");
  if (!isPostEditable(existing.status)) throw new PostNotEditableError();

  const product = wizard.product ?? null;

  await prisma.post.update({
    where: { id: postId },
    data: {
      brandId: wizard.brandId!,
      postType: wizard.postType!,
      scheduledAt: wizard.scheduledAt ? new Date(wizard.scheduledAt) : null,
      mainContent: wizard.mainContent,
      productId: product?.id ?? null,
      productHandle: product?.handle ?? null,
      productTitle: product?.title ?? null,
      productUrl: product?.url ?? null,
      variantId: product?.variantId ?? null,
      variantTitle: product?.variantTitle ?? null,
    },
  });

  // Reconcile platform rows against the new selection. Rows are matched by
  // account id (account rows) or platform (manual rows) so an unchanged target
  // keeps its row (and thus its status, publishAt, and queued job) rather than
  // being deleted and recreated.
  const desiredRows = await resolvePlatformRows(shop, wizard);
  const existingByKey = new Map(
    existing.platformPosts.map((pp) => [platformRowKey(pp), pp] as const),
  );
  const desiredKeys = new Set(desiredRows.map(platformRowKey));

  // Remove rows no longer selected; cancel any queued job first so it does not
  // fire against a row we are about to delete.
  for (const pp of existing.platformPosts) {
    if (!desiredKeys.has(platformRowKey(pp))) {
      if (pp.bullJobId) await removeJob(pp.bullJobId);
      await prisma.postPlatform.delete({ where: { id: pp.id } });
    }
  }

  // Add newly selected targets and update per-platform content on kept rows.
  for (const r of desiredRows) {
    const current = existingByKey.get(platformRowKey(r));
    if (current) {
      // Kept target: update its content but preserve status/publishAt/job.
      await prisma.postPlatform.update({
        where: { id: current.id },
        data: { content: r.content, extraJson: r.extraJson },
      });
    } else {
      await prisma.postPlatform.create({
        data: {
          postId,
          platform: r.platform,
          socialAccountId: r.socialAccountId,
          content: r.content,
          extraJson: r.extraJson,
        },
      });
    }
  }

  // Media assets are fully replaced to match the wizard.
  await prisma.mediaAsset.deleteMany({ where: { postId } });
  if (wizard.mediaAssets.length > 0) {
    await prisma.mediaAsset.createMany({
      data: wizard.mediaAssets.map((asset, i) => ({
        postId,
        url: asset.url,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        durationSec: asset.durationSec,
        sizeBytes: asset.sizeBytes,
        altText: asset.altText,
        sortOrder: i,
      })),
    });
  }

  // Remember hashtags for the linked product, same as createPost. Non-fatal.
  if (product?.id) {
    try {
      await recordProductHashtags(shop, product.id, wizard.mainContent);
    } catch {
      // ignore
    }
  }

  return postId;
}

/**
 * Remove every queued BullMQ job tied to a post: the per-platform jobs whose
 * ids live on each PostPlatform row, plus any legacy post-level job on
 * Post.bullJobId (from before publishing became per-platform). Also clears the
 * stored job ids so the rows are not left pointing at removed jobs.
 */
export async function removeAllJobsForPost(postId: string, legacyJobId: string | null) {
  const platformPosts = await prisma.postPlatform.findMany({
    where: { postId },
    select: { id: true, bullJobId: true },
  });
  for (const pp of platformPosts) {
    if (pp.bullJobId) {
      await removeJob(pp.bullJobId);
      await prisma.postPlatform.update({
        where: { id: pp.id },
        data: { bullJobId: null },
      });
    }
  }
  if (legacyJobId) {
    await removeJob(legacyJobId);
  }
}

export async function cancelPost(postId: string, shop: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, shop } });
  if (!post) throw new Error("Post not found");
  await removeAllJobsForPost(postId, post.bullJobId);
  await prisma.post.update({
    where: { id: postId },
    data: { status: PostStatus.Cancelled, bullJobId: null },
  });
}

export async function reschedulePost(
  postId: string,
  shop: string,
  newScheduledAt: Date,
) {
  const post = await prisma.post.findFirst({ where: { id: postId, shop } });
  if (!post) throw new Error("Post not found");
  await removeAllJobsForPost(postId, post.bullJobId);
  await schedulePost(postId, newScheduledAt);
}

export async function updatePlatformContent(
  postId: string,
  platform: string,
  content: string,
  extra?: Record<string, unknown>,
) {
  await prisma.postPlatform.updateMany({
    where: { postId, platform },
    data: {
      content,
      extraJson: extra ? JSON.stringify(extra) : null,
    },
  });
}

/**
 * Platform-post statuses that are done and will not change on their own. Kept in
 * sync with the same list in worker/processors/publishPost.ts. "awaiting_manual"
 * is intentionally excluded so a post keeps a manual platform pending.
 */
const TERMINAL_PLATFORM_STATUSES: string[] = [
  PlatformPostStatus.Published,
  PlatformPostStatus.Failed,
  PlatformPostStatus.Skipped,
];

/**
 * Recompute the parent Post.status from its platform rows. This mirrors
 * recomputePostStatus in worker/processors/publishPost.ts. That module
 * instantiates its own PrismaClient and imports the adapters/token stack, so it
 * is not cleanly importable into a Remix route; we replicate the small aggregate
 * here against the shared app prisma client. Keep the two in sync.
 */
async function recomputePostStatus(postId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({
      where: { id: postId },
      select: { id: true, status: true, platformPosts: { select: { status: true } } },
    });
    if (!post) return;
    if (post.status === PostStatus.Cancelled) return;

    const platforms = post.platformPosts;
    if (platforms.length === 0) return;

    const allTerminal = platforms.every((p) =>
      TERMINAL_PLATFORM_STATUSES.includes(p.status),
    );
    if (!allTerminal) return; // work still outstanding (e.g. another manual platform)

    const allFailed = platforms.every(
      (p) => p.status === PlatformPostStatus.Failed,
    );
    const finalStatus = allFailed ? PostStatus.Failed : PostStatus.Published;

    await tx.post.update({
      where: { id: postId },
      data: { status: finalStatus, publishedAt: new Date() },
    });
  });
}

/**
 * Merchant confirms they manually posted a platform that was awaiting_manual.
 * Marks it published and re-runs the parent status aggregate.
 */
export async function markPlatformPosted(
  postId: string,
  postPlatformId: string,
  shop: string,
) {
  const post = await prisma.post.findFirst({
    where: { id: postId, shop },
    select: { id: true },
  });
  if (!post) throw new Error("Post not found");

  await prisma.postPlatform.updateMany({
    where: {
      id: postPlatformId,
      postId,
      status: PlatformPostStatus.AwaitingManual,
    },
    data: {
      status: PlatformPostStatus.Published,
      publishedAt: new Date(),
      errorMessage: null,
    },
  });

  await recomputePostStatus(postId);
}

/**
 * Merchant skips a platform that was awaiting_manual (chose not to post it).
 */
export async function skipPlatform(
  postId: string,
  postPlatformId: string,
  shop: string,
) {
  const post = await prisma.post.findFirst({
    where: { id: postId, shop },
    select: { id: true },
  });
  if (!post) throw new Error("Post not found");

  await prisma.postPlatform.updateMany({
    where: {
      id: postPlatformId,
      postId,
      status: PlatformPostStatus.AwaitingManual,
    },
    data: { status: PlatformPostStatus.Skipped },
  });

  await recomputePostStatus(postId);
}

export async function getUpcomingPosts(shop: string, days = 7) {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return prisma.post.findMany({
    where: {
      shop,
      status: PostStatus.Scheduled,
      scheduledAt: { gte: now, lte: end },
    },
    include: {
      brand: { select: { name: true } },
      platformPosts: { select: { platform: true } },
    },
    orderBy: { scheduledAt: "asc" },
  });
}
