import type { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { getAdapter } from "../../app/adapters/index.js";
import { getFreshToken } from "../../app/services/token-refresh.server.js";
import type { Platform } from "../../app/types/post.js";
import { PostStatus, PlatformPostStatus } from "../../app/types/post.js";

const prisma = new PrismaClient();

// New per-platform payload. Legacy jobs carry only { postId }.
interface PlatformJobData {
  postId: string;
  postPlatformId: string;
  platform: string;
}

interface LegacyJobData {
  postId: string;
  postPlatformId?: undefined;
}

type JobData = PlatformJobData | LegacyJobData;

// In-flight platform status. PlatformPostStatus has no "publishing" member and
// its type module is out of scope to edit, but the DB column is a free String,
// so we use the same "publishing" value the parent Post uses to mark work as in
// progress. A platform sits here between claim and success/failure.
const PLATFORM_PUBLISHING = "publishing";

/** Platform-post statuses that are done and will not change on their own. */
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
  // is already published (done) or publishing (in flight), skip cleanly.
  if (
    pp.status === PlatformPostStatus.Published ||
    pp.status === PLATFORM_PUBLISHING
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

  // Mark this platform in-flight so a concurrent/retried job skips it.
  await prisma.postPlatform.update({
    where: { id: postPlatformId },
    data: { status: PLATFORM_PUBLISHING },
  });

  try {
    const adapter = getAdapter(platform);

    // Decrypts the stored token and refreshes it in place if near expiry.
    const token = await getFreshToken(post.brandId, platform);

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

  await prisma.post.update({
    where: { id: postId },
    data: { status: PostStatus.Publishing },
  });

  const results = await Promise.allSettled(
    post.platformPosts.map(async (pp) => {
      const platform = pp.platform as Platform;
      const adapter = getAdapter(platform);

      // Decrypts the stored token and refreshes it in place if near expiry.
      const token = await getFreshToken(post.brandId, platform);

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
