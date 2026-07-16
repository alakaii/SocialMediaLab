import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

let postQueue: Queue | undefined;

function getPostQueue(): Queue {
  if (!postQueue) {
    postQueue = new Queue("social-posts", { connection });
  }
  return postQueue;
}

export interface PlatformJobData {
  postId: string;
  postPlatformId: string;
  platform: string;
}

/**
 * Enqueue a single platform's publish, delayed to that platform's own jittered
 * fire time. One BullMQ job now maps to one PostPlatform row.
 */
export async function enqueuePlatformPost(data: PlatformJobData, fireAt: Date) {
  const queue = getPostQueue();
  const delay = Math.max(0, fireAt.getTime() - Date.now());
  return queue.add("publish", data, {
    delay,
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  });
}

export async function removeJob(jobId: string) {
  const queue = getPostQueue();
  const job = await queue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}
