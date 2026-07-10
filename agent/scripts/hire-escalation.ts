/**
 * Runnable harness: hires Themis (Fact-Check) as a standalone tiebreaker
 * call and prints the outcome. Respects CROO_SIMULATE from .env — defaults
 * to simulate (offline, no network, $0). Set CROO_SIMULATE=false in
 * agent/.env, with a real CROO_API_KEY and ESCALATION_AGENT_SERVICE_ID, plus
 * --confirm-real-spend, to make a real ~$0.03 call.
 *
 * This calls Themis directly with a supplied (or default) health/trust
 * disagreement — it does NOT run Repo Doctor/VERIS first. Use
 * `npm run investigate` for the full live pipeline (gate -> both lenses ->
 * Themis if they disagree).
 *
 * Usage:
 *   npm run hire:escalation -- [--confirm-real-spend]
 *     [--package=<name>] [--health=healthy|mixed|unhealthy]
 *     [--trust=trusted|caution|high_risk] [--concern="..."] [--source=<ref>]...
 *
 * Defaults reproduce the demo's malicious_release scenario (healthy codebase,
 * high_risk trust signal, postinstall exfiltration concern).
 */
import type { EventTypeName } from "@croo-network/sdk";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { connectCrooEventStream, confirmAuth, createCrooClient } from "../src/croo/client.js";
import { OrderEventCorrelator } from "../src/croo/orderCorrelator.js";
import { hireEscalation } from "../src/hire/escalation.js";
import type { HealthVerdict, TrustVerdict } from "../src/merge/types.js";

function unusedStreamStub() {
  return { on: (_eventType: EventTypeName | string, _handler: (event: never) => void) => undefined } as never;
}

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
function argValues(args: string[], name: string): string[] {
  const prefix = `--${name}=`;
  return args.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length));
}

/** Unconfirmed shape (SDK_NOTES.md item 21) — same status Repo Doctor's and VERIS's fixtures started in. */
const SIMULATED_REPORT_TEXT = [
  "THEMIS FACT-CHECK",
  "",
  "Confidence: 0.075",
  "",
  "The postinstall script added in 2.4.1 was verified to run `curl` piping process.env",
  "to an external host — matches a known exfiltration pattern. Could not verify this",
  "is safe to ship.",
].join("\n");

const HEALTH_VERDICTS: readonly HealthVerdict[] = ["healthy", "mixed", "unhealthy"];
const TRUST_VERDICTS: readonly TrustVerdict[] = ["trusted", "caution", "high_risk"];

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const packageName = argValue(args, "package") ?? "evil-dep";
  const healthArg = argValue(args, "health") ?? "healthy";
  const trustArg = argValue(args, "trust") ?? "high_risk";
  const trustConcern =
    argValue(args, "concern") ?? "advisory reports a postinstall script exfiltrating environment variables";
  const sources = argValues(args, "source");

  if (!HEALTH_VERDICTS.includes(healthArg as HealthVerdict)) {
    logger.error(`--health must be one of ${HEALTH_VERDICTS.join("|")}, got "${healthArg}"`);
    process.exitCode = 1;
    return;
  }
  if (!TRUST_VERDICTS.includes(trustArg as TrustVerdict)) {
    logger.error(`--trust must be one of ${TRUST_VERDICTS.join("|")}, got "${trustArg}"`);
    process.exitCode = 1;
    return;
  }
  const healthVerdict = healthArg as HealthVerdict;
  const trustVerdict = trustArg as TrustVerdict;

  logger.info(`CROO_SIMULATE=${env.CROO_SIMULATE} — ${env.CROO_SIMULATE ? "no network call, no spend" : "REAL call, REAL USDC"}`);

  // Safety guard (SDK_NOTES.md item 20): a stale CROO_SIMULATE=false alone
  // must never enable a real spend — every real run needs this flag too.
  if (!env.CROO_SIMULATE && !args.includes("--confirm-real-spend")) {
    logger.error(
      "CROO_SIMULATE=false but --confirm-real-spend was not passed. Refusing to spend real USDC without explicit confirmation on THIS run.\n" +
        "Re-run with: npm run hire:escalation -- --confirm-real-spend",
    );
    process.exitCode = 1;
    return;
  }

  if (env.CROO_SIMULATE) {
    const correlator = new OrderEventCorrelator(unusedStreamStub());
    const outcome = await hireEscalation({
      client: unusedStreamStub(),
      correlator,
      packageName,
      healthVerdict,
      trustVerdict,
      trustConcern,
      sources,
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
    const outcome = await hireEscalation({
      client,
      correlator,
      packageName,
      healthVerdict,
      trustVerdict,
      trustConcern,
      sources,
      simulate: false,
    });
    logger.info("Outcome:", outcome);
    if (!outcome.ok) {
      process.exitCode = 1;
      return;
    }

    // Re-fetch the delivery (free, read-only) to show the FULL raw payload
    // pre-normalization, so the adapter's parsing can be checked against
    // what Themis actually sent, not just the extracted score.
    const delivery = await client.getDelivery(outcome.orderId);
    logger.info("Raw delivery record:", delivery);
    logger.info("Raw deliverable text (pre-normalization):", delivery.deliverableText || delivery.deliverableSchema);
  } finally {
    stream.close();
  }
}

main().catch((err) => {
  logger.error("hire-escalation script failed:", err);
  process.exitCode = 1;
});
