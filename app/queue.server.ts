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

export async function enqueuePost(postId: string, scheduledAt: Date) {
  const queue = getPostQueue();
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  return queue.add(
    "publish",
    { postId },
    {
      delay,
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  );
}

export async function removeJob(jobId: string) {
  const queue = getPostQueue();
  const job = await queue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}
