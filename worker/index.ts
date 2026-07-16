import { Worker, QueueEvents } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { connection, QUEUE_NAME } from "./queues.js";
import { publishPost, recomputePostStatus } from "./processors/publishPost.js";
import { PostStatus, PlatformPostStatus } from "../app/types/post.js";

const prisma = new PrismaClient();

const worker = new Worker(QUEUE_NAME, publishPost, {
  connection,
  concurrency: 5,
});

const queueEvents = new QueueEvents(QUEUE_NAME, { connection });

worker.on("completed", (job) => {
  console.log(`[worker] Job ${job.id} completed (post: ${job.data.postId})`);
});

worker.on("failed", async (job, err) => {
  if (!job) return;
  console.error(`[worker] Job ${job.id} failed: ${err.message}`);

  // Only act once no attempts remain.
  if (job.attemptsMade < (job.opts.attempts ?? 1)) return;

  try {
    if (job.data.postPlatformId) {
      // Per-platform job: mark just this platform failed (the processor already
      // does, but this is the safety net), then let the aggregate recompute
      // decide the post status. A single platform failing must not fail the
      // whole post when other platforms may have succeeded.
      await prisma.postPlatform.update({
        where: { id: job.data.postPlatformId },
        data: {
          status: PlatformPostStatus.Failed,
          errorMessage: err.message,
        },
      });
      await recomputePostStatus(job.data.postId);
    } else {
      // Legacy whole-post job: preserve the original behavior.
      await prisma.post.update({
        where: { id: job.data.postId },
        data: { status: PostStatus.Failed },
      });
    }
  } catch (e) {
    console.error("[worker] Failed to update status after job failure:", e);
  }
});

queueEvents.on("error", (err) => {
  console.error("[queue-events] error:", err);
});

process.on("SIGTERM", async () => {
  console.log("[worker] SIGTERM received, closing gracefully...");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
});

console.log(`[worker] Listening on queue: ${QUEUE_NAME}`);
