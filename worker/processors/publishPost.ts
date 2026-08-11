import type { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { getAdapter } from "../../app/adapters/index.js";
import { getFreshToken } from "../../app/services/token-refresh.server.js";
import type { Platform } from "../../app/types/post.js";
import { PostStatus, PlatformPostStatus } from "../../app/types/post.js";
import { isManualPlatform } from "../../app/utils/platformConstraints.js";
import {
  isFetchableMediaUrl,
  LEGACY_MEDIA_UNAVAILABLE_MESSAGE,
} from "../../app/utils/mediaUrl.js";

const prisma = new PrismaClient();

// New per-platform payload. Legacy jobs carry only { postId }.
interface PlatformJobData {
  postId: string;
  postPlatformId: string;
  platform: string;
  // Added by the shop-level-accounts refactor. Older jobs enqueued before the
  // refactor omit it; those resolve the account from the PostPlatform row or the
  // post's brand instead (see resolveSocialAccountId).
  socialAccountId?: string | null;
}

interface LegacyJobData {
  postId: string;
  postPlatformId?: undefined;
}

type JobData = PlatformJobData | LegacyJobData;

/**
 * Resolve which shop-level account a platform row should publish to when the row
 * itself has no socialAccountId (a pre-refactor row, or a job enqueued before the
 * column existed). Picks the account the post's brand is linked to for the given
 * platform. Returns null if the brand has no linked account for it.
 */
async function resolveSocialAccountId(
  brandId: string,
  platform: string,
): Promise<string | null> {
  const link = await prisma.brandSocialAccount.findFirst({
    where: { brandId, socialAccount: { is: { platform } } },
    select: { socialAccountId: true },
  });
  return link?.socialAccountId ?? null;
}

/**
 * True when the post carries media the adapters cannot fetch. Assets added
 * before the Shopify Files migration hold a relative "/uploads/..." URL whose
 * file no longer exists, and every adapter blows up on it with "Failed to parse
 * URL". There is nothing a retry can fix, so the platform is failed with an
 * explanation instead.
 */
function hasUnavailableMedia(mediaAssets: { url: string }[]): boolean {
  return mediaAssets.some((asset) => !isFetchableMediaUrl(asset.url));
}

// In-flight platform status. PlatformPostStatus has no "publishing" member and
// its type module is out of scope to edit, but the DB column is a free String,
// so we use the same "publishing" value the parent Post uses to mark work as in
// progress. A platform sits here between claim and success/failure.
const PLATFORM_PUBLISHING = "publishing";

/**
 * Platform-post statuses that are done and will not change on their own.
 * Note: "awaiting_manual" is deliberately excluded — a manual platform is not
 * finished until the merchant confirms from the UI, so it keeps the parent post
 * non-terminal (in "publishing") until then.
 */
const TERMINAL_PLATFORM_STATUSES: string[] = [
  PlatformPostStatus.Published,
  PlatformPostStatus.Failed,
  PlatformPostStatus.Skipped,
];

/**
 * Recompute the parent Post.status from its platform rows, preserving the
 * semantics of the original single-job aggregate:
 *   - all platforms failed  -> failed
 *   - otherwise (all/partial success) -> published
 * While any platform is still non-terminal (pending/publishing) the post is
 * left as-is (scheduled/publishing) so we do not finalize early.
 *
 * This reads freshly committed platform rows and is safe to call more than once
 * (idempotent), so concurrent platform jobs finishing at the same time converge
 * on the same result: whichever job commits its own row last will see every row
 * terminal and write the final status.
 */
export async function recomputePostStatus(postId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({
      where: { id: postId },
      select: { id: true, status: true, platformPosts: { select: { status: true } } },
    });
    if (!post) return;
    // Never resurrect a cancelled post.
    if (post.status === PostStatus.Cancelled) return;

    const platforms = post.platformPosts;
    if (platforms.length === 0) return;

    const allTerminal = platforms.every((p) =>
      TERMINAL_PLATFORM_STATUSES.includes(p.status),
    );
    if (!allTerminal) return; // work still outstanding; leave post as-is

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
 * Publish a single platform (new one-job-per-platform path).
 */
async function publishSinglePlatform(job: Job<PlatformJobData>): Promise<void> {
  const { postId, postPlatformId } = job.data;

  const pp = await prisma.postPlatform.findUnique({
    where: { id: postPlatformId },
    include: {
      post: { include: { mediaAssets: { orderBy: { sortOrder: "asc" } } } },
    },
  });

  if (!pp || !pp.post) {
    throw new Error(`PostPlatform ${postPlatformId} not found`);
  }

  const post = pp.post;

  if (post.status === PostStatus.Cancelled) {
    return; // Silently skip cancelled posts
  }

  // Idempotency guard: jobs can retry, so never publish a platform twice. If it
  // is already published (done), publishing (in flight), or parked awaiting a
  // manual copy-paste, skip cleanly. A retried manual job seeing awaiting_manual
  // must not re-run and reset the merchant's in-progress state.
  if (
    pp.status === PlatformPostStatus.Published ||
    pp.status === PLATFORM_PUBLISHING ||
    pp.status === PlatformPostStatus.AwaitingManual
  ) {
    return;
  }

  const platform = pp.platform as Platform;

  // Move the parent post to "publishing" as soon as the first platform starts.
  if (post.status === PostStatus.Scheduled) {
    await prisma.post.update({
      where: { id: postId },
      data: { status: PostStatus.Publishing },
    });
  }

  // Manual platforms (e.g. RedNote) have no posting API. Instead of calling an
  // adapter or fetching a token, park this platform in "awaiting_manual" and
  // return successfully. recomputePostStatus treats that as non-terminal, so the
  // parent post stays in "publishing" until the merchant confirms from the post
  // detail page. The BullMQ job completes here and is not retried.
  if (isManualPlatform(platform)) {
    await prisma.postPlatform.update({
      where: { id: postPlatformId },
      data: { status: PlatformPostStatus.AwaitingManual },
    });
    return;
  }

  // Media the adapter cannot fetch is a dead end, so fail this platform with a
  // plain explanation before a token is fetched or an adapter is called. No
  // throw: BullMQ must not retry something only the merchant can fix.
  if (hasUnavailableMedia(post.mediaAssets)) {
    await prisma.postPlatform.update({
      where: { id: postPlatformId },
      data: {
        status: PlatformPostStatus.Failed,
        errorMessage: LEGACY_MEDIA_UNAVAILABLE_MESSAGE,
      },
    });
    await recomputePostStatus(postId);
    return;
  }

  // Resolve the shop-level account to publish to. The row's own socialAccountId
  // is the source of truth; fall back to the job's hint, then to the post's
  // brand's linked account for this platform (covers pre-refactor jobs/rows).
  const socialAccountId =
    pp.socialAccountId ??
    job.data.socialAccountId ??
    (await resolveSocialAccountId(post.brandId, platform));

  if (!socialAccountId) {
    // No account can be resolved (e.g. it was disconnected). Fail with a clear
    // message and do NOT throw: retrying will not help until the merchant
    // reconnects the account and reschedules.
    await prisma.postPlatform.update({
      where: { id: postPlatformId },
      data: {
        status: PlatformPostStatus.Failed,
        errorMessage: `No connected account for ${platform}. Reconnect it on the Connections page, then reschedule this post.`,
      },
    });
    await recomputePostStatus(postId);
    return;
  }

  // Mark this platform in-flight so a concurrent/retried job skips it.
  await prisma.postPlatform.update({
    where: { id: postPlatformId },
    data: { status: PLATFORM_PUBLISHING },
  });

  try {
    const adapter = getAdapter(platform);

    // Decrypts the stored token and refreshes it in place if near expiry.
    const token = await getFreshToken(socialAccountId);

    const content = pp.content ?? post.mainContent;
    const extra = pp.extraJson
      ? (JSON.parse(pp.extraJson) as Record<string, unknown>)
      : {};

    const result = await adapter.publish({
      content,
      mediaAssets: post.mediaAssets,
      extra,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? undefined,
      tokenSecret: token.tokenSecret ?? undefined,
      accountId: token.accountId,
    });

    await prisma.postPlatform.update({
      where: { id: postPlatformId },
      data: {
        status: PlatformPostStatus.Published,
        platformPostId: result.platformPostId,
        publishedAt: new Date(),
        errorMessage: null,
      },
    });

    await recomputePostStatus(postId);
  } catch (err) {
    // Record the failure, then recompute (so a fully-terminal post is finalized)
    // and rethrow so BullMQ retries. On the next attempt the guard sees "failed"
    // (retryable) rather than "publishing", so the platform is tried again.
    await prisma.postPlatform.update({
      where: { id: postPlatformId },
      data: {
        status: PlatformPostStatus.Failed,
        errorMessage: String(err instanceof Error ? err.message : err),
      },
    });
    await recomputePostStatus(postId);
    throw err;
  }
}

/**
 * Legacy fallback: publish ALL platforms in one job. Used only for jobs that
 * were already sitting in Redis in the old { postId } shape before this app was
 * upgraded to one-job-per-platform. New scheduling never enqueues this shape.
 */
async function publishAllPlatformsLegacy(job: Job<LegacyJobData>): Promise<void> {
  const { postId } = job.data;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      platformPosts: true,
      mediaAssets: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!post) {
    throw new Error(`Post ${postId} not found`);
  }

  if (post.status === PostStatus.Cancelled) {
    return; // Silently skip cancelled posts
  }

  // Same dead end as the per-platform path: media the adapters cannot fetch
  // fails every platform on the post with an explanation, and does not throw, so
  // the job is not retried.
  if (hasUnavailableMedia(post.mediaAssets)) {
    await prisma.postPlatform.updateMany({
      where: { postId },
      data: {
        status: PlatformPostStatus.Failed,
        errorMessage: LEGACY_MEDIA_UNAVAILABLE_MESSAGE,
      },
    });
    await prisma.post.update({
      where: { id: postId },
      data: { status: PostStatus.Failed },
    });
    return;
  }

  await prisma.post.update({
    where: { id: postId },
    data: { status: PostStatus.Publishing },
  });

  const results = await Promise.allSettled(
    post.platformPosts.map(async (pp) => {
      const platform = pp.platform as Platform;
      const adapter = getAdapter(platform);

      // Resolve the account the same way the per-platform path does.
      const socialAccountId =
        pp.socialAccountId ??
        (await resolveSocialAccountId(post.brandId, platform));
      if (!socialAccountId) {
        throw new Error(
          `No connected account for ${platform}. Reconnect it on the Connections page.`,
        );
      }

      // Decrypts the stored token and refreshes it in place if near expiry.
      const token = await getFreshToken(socialAccountId);

      const content = pp.content ?? post.mainContent;
      const extra = pp.extraJson ? (JSON.parse(pp.extraJson) as Record<string, unknown>) : {};

      const result = await adapter.publish({
        content,
        mediaAssets: post.mediaAssets,
        extra,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? undefined,
        tokenSecret: token.tokenSecret ?? undefined,
        accountId: token.accountId,
      });

      await prisma.postPlatform.update({
        where: { id: pp.id },
        data: {
          status: PlatformPostStatus.Published,
          platformPostId: result.platformPostId,
          publishedAt: new Date(),
        },
      });

      return result;
    }),
  );

  const allSucceeded = results.every((r) => r.status === "fulfilled");
  const allFailed = results.every((r) => r.status === "rejected");

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      await prisma.postPlatform.update({
        where: { id: post.platformPosts[i].id },
        data: {
          status: PlatformPostStatus.Failed,
          errorMessage: String(result.reason),
        },
      });
    }
  }

  const finalStatus = allFailed
    ? PostStatus.Failed
    : allSucceeded
      ? PostStatus.Published
      : PostStatus.Published; // partial success → still mark as published

  await prisma.post.update({
    where: { id: postId },
    data: {
      status: finalStatus,
      publishedAt: new Date(),
    },
  });

  if (allFailed) {
    throw new Error("All platform publishes failed — job will retry.");
  }
}

/**
 * Queue processor entry point. Routes to the per-platform path for new jobs and
 * falls back to the legacy all-platforms path for pre-upgrade jobs whose data
 * lacks a postPlatformId.
 */
export async function publishPost(job: Job<JobData>): Promise<void> {
  if (job.data.postPlatformId) {
    return publishSinglePlatform(job as Job<PlatformJobData>);
  }
  return publishAllPlatformsLegacy(job as Job<LegacyJobData>);
}
