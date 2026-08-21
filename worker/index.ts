import { Queue, Worker, QueueEvents } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { connection, QUEUE_NAME, USAGE_QUEUE_NAME } from "./queues.js";
import { publishPost, recomputePostStatus } from "./processors/publishPost.js";
import { usageSweep } from "./processors/usageSweep.js";
import { PostStatus, PlatformPostStatus } from "../app/types/post.js";

const prisma = new PrismaClient();

const worker = new Worker(QUEUE_NAME, publishPost, {
  connection,
  concurrency: 5,
});

// --- Usage billing -----------------------------------------------------------
// One sweep a day at 03:10 UTC, well clear of midnight so a month boundary is
// unambiguous whatever the clock does. Concurrency 1: two sweeps at once would
// race on the ledger's unique constraint for no benefit.

const usageQueue = new Queue(USAGE_QUEUE_NAME, { connection });

const usageWorker = new Worker(USAGE_QUEUE_NAME, usageSweep, {
  connection,
  concurrency: 1,
});

/** Stable id, so every boot upserts the same schedule instead of adding one. */
const USAGE_SCHEDULER_ID = "usage-billing-daily";

// Registered once, at boot. upsertJobScheduler is keyed on the id above, so a
// redeploy (or several replicas booting at once) converges on a single schedule
// rather than stacking duplicates. Failures are logged and swallowed: an
// unreachable Redis at boot must not stop the publishing worker from starting,
// and the next boot re-registers.
usageQueue
  .upsertJobScheduler(
    USAGE_SCHEDULER_ID,
    { pattern: "10 3 * * *", tz: "UTC" },
    { name: "usage-sweep" },
  )
  .then(() => {
    console.log(
      `[usage-billing] daily sweep scheduled (03:10 UTC) on queue: ${USAGE_QUEUE_NAME}`,
    );
  })
  .catch((err) => {
    console.error("[usage-billing] could not schedule the daily sweep:", err);
  });

usageWorker.on("failed", (job, err) => {
  console.error(`[usage-billing] sweep job ${job?.id} failed: ${err.message}`);
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
  await usageWorker.close();
  await usageQueue.close();
  await prisma.$disconnect();
  process.exit(0);
});

console.log(`[worker] Listening on queue: ${QUEUE_NAME}`);
