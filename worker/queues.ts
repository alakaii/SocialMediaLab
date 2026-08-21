import IORedis from "ioredis";

export const connection = new IORedis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);

export const QUEUE_NAME = "social-posts";

// Kept apart from the publishing queue on purpose: a backlog of scheduled posts
// must never delay the once-a-day billing sweep, and a stuck sweep must never
// occupy a publishing worker slot.
export const USAGE_QUEUE_NAME = "usage-billing";
