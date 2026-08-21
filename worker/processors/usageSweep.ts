/**
 * Daily usage-billing sweep.
 *
 * Sends one App Event per App Pricing shop per calendar month, charging the
 * plan's $2-per-brand meter. Running daily rather than monthly is deliberate:
 * the emission is keyed to the period, so a day the worker was down costs
 * nothing, the next run picks the period up. All the policy lives in
 * usage-billing.server; this file is the BullMQ wrapper around it.
 */

import { runUsageSweep } from "../../app/services/usage-billing.server.js";

export async function usageSweep(): Promise<void> {
  const summary = await runUsageSweep();
  console.log(
    `[usage-billing] sweep finished: sent=${summary.sent} ` +
      `dryRun=${summary.dryRun} skipped=${summary.skipped} failed=${summary.failed}`,
  );
}
