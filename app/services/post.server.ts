import { prisma } from "../db.server.js";
import { enqueuePlatformPost, removeJob } from "../queue.server.js";
import { jitteredPublishAt } from "../utils/jitter.js";
import { recordProductHashtags } from "./hashtag.server.js";
import type { WizardState } from "../types/post.js";
import { PostStatus, PlatformPostStatus } from "../types/post.js";

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
      platformPosts: true,
      mediaAssets: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function createPost(shop: string, wizard: WizardState) {
  const product = wizard.product ?? null;
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
      platformPosts: {
        create: wizard.platforms.map((platform) => {
          const override = wizard.platformOverrides[platform];
          return {
            platform,
            content: override?.content ?? null,
            extraJson: override?.extra ? JSON.stringify(override.extra) : null,
          };
        }),
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
    select: { id: true, platform: true },
  });

  // One BullMQ job per platform, each delayed to that platform's own jittered
  // publishAt. The job id is stored on the PostPlatform row so we can cancel or
  // reschedule it later. Post.bullJobId is no longer used for scheduled posts
  // (nulled below) but the column is kept for backward compatibility.
  for (const pp of platformPosts) {
    const publishAt = jitteredPublishAt(scheduledAt, now);
    const job = await enqueuePlatformPost(
      { postId, postPlatformId: pp.id, platform: pp.platform },
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
 * Remove every queued BullMQ job tied to a post: the per-platform jobs whose
 * ids live on each PostPlatform row, plus any legacy post-level job on
 * Post.bullJobId (from before publishing became per-platform). Also clears the
 * stored job ids so the rows are not left pointing at removed jobs.
 */
async function removeAllJobsForPost(postId: string, legacyJobId: string | null) {
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
