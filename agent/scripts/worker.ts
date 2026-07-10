/**
 * The always-on Quorum process (PRD §8, M5/M6): opens ONE CROO WebSocket
 * connection used for both roles — provider (serves quorum.register orders)
 * and requester (hires Repo Doctor/VERIS/Themis while running each baseline
 * scan or poll-detected event) — then runs the continuous poll loop
 * forever. `npm run worker`.
 *
 * Unlike scripts/investigate.ts (a one-shot manual verification tool), this
 * script always uses the real CROO client: a provider that only ever ran in
 * CROO_SIMULATE mode couldn't actually accept a real buyer's negotiation.
 * CROO_SIMULATE still governs whether the OUTBOUND hires inside each
 * baseline scan / poll cycle spend real USDC (see investigate()/hireAgent()).
 */
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { connectCrooEventStream, confirmAuth, createCrooClient } from "../src/croo/client.js";
import { OrderEventCorrelator } from "../src/croo/orderCorrelator.js";
import { startProviderLoop } from "../src/provider/providerLoop.js";
import { runBaselineScan } from "../src/provider/registerRepo.js";
import { RequirementsCache } from "../src/provider/requirementsCache.js";
import { openDb } from "../src/store/db.js";
import { startPollLoop } from "../src/worker/pollLoop.js";

async function main(): Promise<void> {
  if (!env.CROO_API_KEY) {
    logger.error(
      "CROO_API_KEY is not set — the worker needs a real SDK-Key to serve quorum.register orders. Refusing to start.",
    );
    process.exitCode = 1;
    return;
  }

  const db = openDb();
  const client = createCrooClient();

  const authed = await confirmAuth(client);
  logger.info(`worker: auth check (listOrders) ${authed ? "OK" : "FAILED"}`);
  if (!authed) {
    process.exitCode = 1;
    return;
  }

  const stream = await connectCrooEventStream(client);
  const correlator = new OrderEventCorrelator(stream);
  const requirementsCache = new RequirementsCache(db, client);

  startProviderLoop({
    client,
    stream,
    requirementsCache,
    runBaseline: (request) => runBaselineScan({ db, client, correlator, request, simulate: env.CROO_SIMULATE }),
  });
  logger.info("worker: provider loop live — listening for order_negotiation_created / order_paid");

  const { stop: stopPolling } = startPollLoop({ db, client, correlator, simulate: env.CROO_SIMULATE });
  logger.info(`worker: poll loop started (every ${env.POLL_INTERVAL_MINUTES} minute(s))`);

  const shutdown = () => {
    logger.info("worker: shutting down");
    stopPolling();
    stream.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("worker failed to start:", err);
  process.exitCode = 1;
});
