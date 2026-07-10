/**
 * Runnable Step-3 harness: hires Repo Doctor for one GitHub repo and prints
 * the outcome. Respects CROO_SIMULATE from .env — defaults to simulate
 * (offline, no network, $0). Set CROO_SIMULATE=false in agent/.env, with a
 * real CROO_API_KEY and REPO_DOCTOR_SERVICE_ID, to make the one real call
 * milestone 3 asks for.
 *
 * Usage:
 *   npm run hire:repo-doctor -- https://github.com/expressjs/express
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EventTypeName } from "@croo-network/sdk";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { connectCrooEventStream, confirmAuth, createCrooClient } from "../src/croo/client.js";
import { OrderEventCorrelator } from "../src/croo/orderCorrelator.js";
import { hireRepoDoctor } from "../src/hire/repoDoctor.js";

/** hireAgent's simulate path never calls the client or listens on the stream — these are unused placeholders. */
function unusedStreamStub() {
  return { on: (_eventType: EventTypeName | string, _handler: (event: never) => void) => undefined } as never;
}

const DEFAULT_SIMULATED_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/agent-responses/repo-doctor.healthy.json",
);

async function main(): Promise<void> {
  const repoUrl = process.argv[2];
  if (!repoUrl) {
    logger.error("Usage: npm run hire:repo-doctor -- <github-repo-url>");
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
        "Re-run with: npm run hire:repo-doctor -- <repo-url> --confirm-real-spend",
    );
    process.exitCode = 1;
    return;
  }

  if (env.CROO_SIMULATE) {
    const fixture = JSON.parse(readFileSync(DEFAULT_SIMULATED_FIXTURE, "utf-8")) as { raw: unknown };
    // No client/connection needed at all for a simulated run — hireAgent's
    // simulate path never touches either, so these are inert placeholders.
    const correlator = new OrderEventCorrelator(unusedStreamStub());
    const outcome = await hireRepoDoctor({
      client: unusedStreamStub(),
      correlator,
      repoUrl,
      simulate: true,
      simulatedRaw: fixture.raw,
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
    const outcome = await hireRepoDoctor({ client, correlator, repoUrl, simulate: false });
    logger.info("Outcome:", outcome);
    if (!outcome.ok) {
      process.exitCode = 1;
      return;
    }

    // Re-fetch the delivery (free, read-only) to show the FULL raw payload
    // pre-normalization, so the adapter's parsing can be checked against
    // what Repo Doctor actually sent, not just the final verdict.
    const delivery = await client.getDelivery(outcome.orderId);
    logger.info("Raw delivery record:", delivery);
    const rawText = delivery.deliverableText || delivery.deliverableSchema;
    logger.info("Raw deliverable JSON (pre-normalization):", rawText ? JSON.parse(rawText) : undefined);
  } finally {
    stream.close();
  }
}

main().catch((err) => {
  logger.error("hire-repo-doctor script failed:", err);
  process.exitCode = 1;
});
