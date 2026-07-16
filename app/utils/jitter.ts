/**
 * Publish-time jitter.
 *
 * When a post is scheduled we nudge the real fire time a little around the
 * merchant-chosen time so posting does not look formulaic. Each platform gets
 * its own offset, so a multi-platform post staggers instead of firing to every
 * network at the exact same second.
 */

/** Half-width of the jitter window, in seconds (so +/- 5 minutes). */
export const JITTER_WINDOW_SECONDS = 300;

/** Never plan a fire time closer than this to "now", so we never fire in the past. */
export const MIN_LEAD_SECONDS = 10;

/** Random integer offset in [-JITTER_WINDOW_SECONDS, +JITTER_WINDOW_SECONDS]. */
export function randomJitterSeconds(): number {
  const span = JITTER_WINDOW_SECONDS * 2 + 1;
  return Math.floor(Math.random() * span) - JITTER_WINDOW_SECONDS;
}

/**
 * Apply a fresh random offset to scheduledAt and floor the result at
 * now + MIN_LEAD_SECONDS so the planned time is never in the past.
 */
export function jitteredPublishAt(scheduledAt: Date, now: Date = new Date()): Date {
  const jittered = scheduledAt.getTime() + randomJitterSeconds() * 1000;
  const floor = now.getTime() + MIN_LEAD_SECONDS * 1000;
  return new Date(Math.max(jittered, floor));
}
