import { Worker, QueueEvents } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { connection, QUEUE_NAME } from "./queues.js";
import { publishPost } from "./processors/publishPost.js";
import { PostStatus } from "../app/types/post.js";

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

  // If no more attempts remain, mark post as failed
  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    try {
      await prisma.post.update({
        where: { id: job.data.postId },
        data: { status: PostStatus.Failed },
      });
    } catch (e) {
      console.error("[worker] Failed to update post status:", e);
    }
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
