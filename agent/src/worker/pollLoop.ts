import type { AgentClient } from "@croo-network/sdk";
import type Database from "better-sqlite3";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { OrderEventCorrelator } from "../croo/orderCorrelator.js";
import { pollRepoForNewEvents } from "../detector/index.js";
import { processEvent } from "../orchestrate/processEvent.js";
import { listRepos } from "../store/repos.js";

export interface PollOnceParams {
  db: Database.Database;
  client: AgentClient;
  correlator: OrderEventCorrelator;
  simulate?: boolean | undefined;
}

/**
 * One sweep over every registered repo (SPEC §2's steady-state "poll loop"):
 * re-detect events for each repo's (bounded, production-first) dependencies,
 * dedupe against seen_events, and run each newly-admitted event through
 * processEvent() (Risk Gate -> archive, or hire+merge+escalate -> persist ->
 * Slack). A failure on one repo or one event is logged and skipped — it
 * never aborts the sweep for the rest.
 */
export async function pollOnce(params: PollOnceParams): Promise<void> {
  const { db, client, correlator, simulate } = params;
  const repos = listRepos(db);
  logger.info(`pollOnce: sweeping ${repos.length} registered repo(s)`);

  for (const repo of repos) {
    let admitted;
    try {
      admitted = await pollRepoForNewEvents(db, repo.id, repo.github_url, env.BASELINE_SCAN_MAX_DEPS);
    } catch (err) {
      logger.error(`pollOnce: event detection failed for ${repo.github_url}:`, err);
      continue;
    }

    if (admitted.length === 0) continue;
    logger.info(`pollOnce: ${repo.github_url} — ${admitted.length} new event(s)`);

    for (const event of admitted) {
      try {
        const result = await processEvent({ db, client, correlator, repo, event, simulate });
        if (!result.ok) {
          logger.error(`pollOnce: ${event.dependency} degraded — ${result.reason}`);
        }
      } catch (err) {
        logger.error(`pollOnce: unhandled error processing ${event.dependency}:`, err);
      }
    }
  }
}

/**
 * Starts the always-on interval loop (PRD §8's "sleep" step between sweeps).
 * Returns a stop() the caller (scripts/worker.ts) invokes on shutdown. A
 * cycle that throws is caught and logged so one bad sweep can't kill the
 * process — the next interval just tries again.
 */
export function startPollLoop(
  params: PollOnceParams,
  intervalMinutes: number = env.POLL_INTERVAL_MINUTES,
): { stop: () => void } {
  const intervalMs = intervalMinutes * 60_000;
  const timer = setInterval(() => {
    pollOnce(params).catch((err) => logger.error("startPollLoop: pollOnce cycle failed:", err));
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
