import { prisma } from "../db.server.js";
import { enqueuePost, removeJob } from "../queue.server.js";
import type { WizardState } from "../types/post.js";
import { PostStatus } from "../types/post.js";

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
  const post = await prisma.post.create({
    data: {
      shop,
      brandId: wizard.brandId!,
      postType: wizard.postType!,
      status: PostStatus.Draft,
      scheduledAt: wizard.scheduledAt ? new Date(wizard.scheduledAt) : null,
      mainContent: wizard.mainContent,
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
  return post;
}

export async function schedulePost(postId: string, scheduledAt: Date) {
  const job = await enqueuePost(postId, scheduledAt);
  await prisma.post.update({
    where: { id: postId },
    data: {
      status: PostStatus.Scheduled,
      scheduledAt,
      bullJobId: job.id?.toString(),
    },
  });
  return job;
}

export async function createAndSchedulePost(shop: string, wizard: WizardState) {
  const post = await createPost(shop, wizard);
  if (wizard.scheduledAt) {
    await schedulePost(post.id, new Date(wizard.scheduledAt));
  }
  return post;
}

export async function cancelPost(postId: string, shop: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, shop } });
  if (!post) throw new Error("Post not found");
  if (post.bullJobId) {
    await removeJob(post.bullJobId);
  }
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
  if (post.bullJobId) {
    await removeJob(post.bullJobId);
  }
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
