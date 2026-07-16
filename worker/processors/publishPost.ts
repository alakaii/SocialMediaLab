import type { Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { getAdapter } from "../../app/adapters/index.js";
import { getFreshToken } from "../../app/services/token-refresh.server.js";
import type { Platform } from "../../app/types/post.js";
import { PostStatus, PlatformPostStatus } from "../../app/types/post.js";

const prisma = new PrismaClient();

interface JobData {
  postId: string;
}

export async function publishPost(job: Job<JobData>): Promise<void> {
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
