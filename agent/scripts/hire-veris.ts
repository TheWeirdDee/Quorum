/**
 * Runnable harness: hires VERIS Project Due Diligence for one npm package
 * and prints the outcome. Respects CROO_SIMULATE from .env — defaults to
 * simulate (offline, no network, $0). Set CROO_SIMULATE=false in
 * agent/.env, with a real CROO_API_KEY and VERIS_SERVICE_ID, to make a real
 * $0.11 call.
 *
 * Usage:
 *   npm run hire:veris -- <packageName> <githubRepoUrl> [npmHomepage]
 */
import type { EventTypeName } from "@croo-network/sdk";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { connectCrooEventStream, confirmAuth, createCrooClient } from "../src/croo/client.js";
import { OrderEventCorrelator } from "../src/croo/orderCorrelator.js";
import { hireVeris } from "../src/hire/veris.js";

/** hireAgent's simulate path never calls the client or listens on the stream — these are unused placeholders. */
function unusedStreamStub() {
  return { on: (_eventType: EventTypeName | string, _handler: (event: never) => void) => undefined } as never;
}

/**
 * CONFIRMED real-shaped report (SDK_NOTES.md item 19) — VERIS Project Due
 * Diligence returns plain text, not JSON. fixtures/agent-responses/
 * veris.*.json still hold the ORIGINAL (wrong) JSON-shaped guess and are
 * left untouched as a record of that; this is the real shape to simulate
 * against, trimmed to what the parser reads.
 */
const SIMULATED_REPORT_TEXT = `VERIS TRUST REPORT
══════════════════════════════════════════════
Subject:          (simulated)
LEGITIMACY:   22/100  ████░░░░░░░░░░░░░░░░
MATURITY:     29/100  ██████░░░░░░░░░░░░░░
RECOMMENDATION:  ⛔ CRITICAL RISK  [Band: 0-29]
══════════════════════════════════════════════
SCORE BANDS
  90-100  Strongly Trusted    80-89  Trusted
  65-79   Generally Legitimate  50-64  Mixed Signals
  30-49   High Risk            0-29   Critical Risk
══════════════════════════════════════════════`;

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--confirm-real-spend");
  const packageName = args[0];
  const repoUrl = args[1];
  const npmHomepage = args[2];
  if (!packageName || !repoUrl) {
    logger.error("Usage: npm run hire:veris -- <packageName> <githubRepoUrl> [npmHomepage]");
    process.exitCode = 1;
    return;
  }

  logger.info(`CROO_SIMULATE=${env.CROO_SIMULATE} — ${env.CROO_SIMULATE ? "no network call, no spend" : "REAL call, REAL USDC"}`);

  // Safety guard added after a real incident: a stale CROO_SIMULATE=false
  // left over from a previous real call silently enabled another real spend
  // on the next run. Require an explicit, unmissable opt-in for every real
  // call, not just a .env value that's easy to forget was left set.
  if (!env.CROO_SIMULATE && !process.argv.includes("--confirm-real-spend")) {
    logger.error(
      "CROO_SIMULATE=false but --confirm-real-spend was not passed. Refusing to spend real USDC without explicit confirmation on THIS run.\n" +
        "Re-run with: npm run hire:veris -- <packageName> <repoUrl> [npmHomepage] --confirm-real-spend",
    );
    process.exitCode = 1;
    return;
  }

  if (env.CROO_SIMULATE) {
    const correlator = new OrderEventCorrelator(unusedStreamStub());
    const outcome = await hireVeris({
      client: unusedStreamStub(),
      correlator,
      packageName,
      repoUrl,
      npmHomepage,
      simulate: true,
      simulatedRaw: SIMULATED_REPORT_TEXT,
    });
    logger.info("Outcome:", outcome);
    return;
  }

  if (!env.CROO_API_KEY) {
    logger.error("CROO_SIMULATE=false but CROO_API_KEY is not set. Refusing to attempt a real call.");
    process.exitCode = 1;
    return;
  }

  const client = createCrooClient();
  const authed = await confirmAuth(client);
  logger.info(`Auth check (listOrders): ${authed ? "OK" : "FAILED"}`);
  if (!authed) {
    process.exitCode = 1;
    return;
  }

  const stream = await connectCrooEventStream(client);
  const correlator = new OrderEventCorrelator(stream);

  try {
    const outcome = await hireVeris({ client, correlator, packageName, repoUrl, npmHomepage, simulate: false });
    logger.info("Outcome:", outcome);
    if (!outcome.ok) {
      process.exitCode = 1;
      return;
    }

    // Re-fetch the delivery (free, read-only) to show the FULL raw payload
    // pre-normalization, so the adapter's parsing can be checked against
    // what VERIS actually sent, not just the final verdict. VERIS's real
    // deliverable is plain text (SDK_NOTES.md item 19), not JSON — logged
    // verbatim, no JSON.parse attempt.
    const delivery = await client.getDelivery(outcome.orderId);
    logger.info("Raw delivery record:", delivery);
    logger.info("Raw deliverable text (pre-normalization):", delivery.deliverableText || delivery.deliverableSchema);
  } finally {
    stream.close();
  }
}

main().catch((err) => {
  logger.error("hire-veris script failed:", err);
  process.exitCode = 1;
});
