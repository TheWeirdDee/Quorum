/**
 * Runs the FULL investigate() pipeline for one real repo/package: Risk Gate
 * -> Repo Doctor + VERIS (concurrent) -> Themis escalation if they disagree.
 * Prints the raw quorum.decision.v1. This is the real-call verification
 * tool; `npm run demo` is the scripted presentation version with a fixed
 * seeded event and narrative formatting.
 *
 * Usage:
 *   npm run investigate -- --repo=<github-url> --package=<npm-name>
 *     [--npm-homepage=<url>] [--policy=startup|balanced|enterprise]
 *     [--event-type=<TrustEventType>] [--severity=<SeverityHint>]
 *     [--detail="..."] [--ref=<advisory-id-or-url>]
 *     [--confirm-real-spend]
 *
 * Defaults to simulate mode: Repo Doctor healthy, VERIS high_risk, Themis
 * confirms — the demo scenario, deterministic, $0. Add --confirm-real-spend
 * with CROO_SIMULATE=false in agent/.env to make real CAP hires against
 * Repo Doctor, VERIS, and — only if they disagree — Themis.
 *
 * --event-type/--severity/--detail/--ref default to a generic
 * "maintainer_change" framing rather than presuming malice about whatever
 * real package you point this at — override them with real specifics
 * (a real GHSA/CVE, a real ownership-change date, etc.) for an honest run.
 */
import type { AgentClient, EventTypeName } from "@croo-network/sdk";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { connectCrooEventStream, confirmAuth, createCrooClient } from "../src/croo/client.js";
import { OrderEventCorrelator } from "../src/croo/orderCorrelator.js";
import { RISK_POLICIES, RISK_POLICY_NAMES, type RiskPolicyName } from "../src/config/riskPolicy.js";
import type { SeverityHint, TrustEvent, TrustEventType } from "../src/detector/types.js";
import { severityHintSchema, trustEventTypeSchema } from "../src/detector/types.js";
import { investigate } from "../src/orchestrate/investigate.js";

function unusedStreamStub() {
  return { on: (_eventType: EventTypeName | string, _handler: (event: never) => void) => undefined } as never;
}

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const SIMULATED_HEALTHY_RAW = {
  overall_score: 82,
  readme_quality: { score: 78, comment: "Clear docs." },
  test_coverage_signal: { score: 74, comment: "Tests present." },
  dependency_health: { score: 88, comment: "1 outdated dependency." },
  maintenance_activity: { score: 90, comment: "Active commits." },
  recommendations: ["Add coverage reporting."],
};
const SIMULATED_HIGH_RISK_REPORT = "VERIS TRUST REPORT\nLEGITIMACY:   22/100\nRECOMMENDATION: CRITICAL RISK";
const SIMULATED_THEMIS_REPORT = "THEMIS FACT-CHECK\n\nConfidence: 0.075\n\nCould not verify this is safe to ship.";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const real = args.includes("--confirm-real-spend");

  const repoUrl = argValue(args, "repo");
  const packageName = argValue(args, "package");
  if (!repoUrl || !packageName) {
    logger.error("Usage: npm run investigate -- --repo=<github-url> --package=<npm-name> [options]");
    process.exitCode = 1;
    return;
  }
  const npmHomepage = argValue(args, "npm-homepage");

  const policyName = (argValue(args, "policy") ?? "enterprise") as RiskPolicyName;
  if (!RISK_POLICY_NAMES.includes(policyName)) {
    logger.error(`--policy must be one of ${RISK_POLICY_NAMES.join("|")}, got "${policyName}"`);
    process.exitCode = 1;
    return;
  }

  const eventType = (argValue(args, "event-type") ?? "maintainer_change") as TrustEventType;
  if (!trustEventTypeSchema.safeParse(eventType).success) {
    logger.error(`--event-type is not a valid TrustEvent type: "${eventType}"`);
    process.exitCode = 1;
    return;
  }
  const severity = (argValue(args, "severity") ?? "high") as SeverityHint;
  if (!severityHintSchema.safeParse(severity).success) {
    logger.error(`--severity is not a valid severity hint: "${severity}"`);
    process.exitCode = 1;
    return;
  }
  const detail = argValue(args, "detail") ?? "Investigating a supply-chain trust signal for this dependency.";
  const ref = argValue(args, "ref") ?? repoUrl;

  const event: TrustEvent = {
    dependency: `${packageName}@investigate`,
    type: eventType,
    severity_hint: severity,
    source: "github",
    ref,
    observed_at: new Date().toISOString(),
    context: { repo: repoUrl, npm_homepage: npmHomepage, is_production_dependency: true, detail },
  };

  logger.info(`CROO_SIMULATE=${env.CROO_SIMULATE} — ${env.CROO_SIMULATE ? "no network call, no spend" : "REAL calls, REAL USDC"}`);
  logger.info(`policy=${policyName} repo=${repoUrl} package=${packageName} event.type=${eventType} event.severity_hint=${severity}`);

  if (real && env.CROO_SIMULATE) {
    logger.error("--confirm-real-spend was passed but CROO_SIMULATE=true in agent/.env. Set CROO_SIMULATE=false to actually spend.");
    process.exitCode = 1;
    return;
  }
  if (!real && !env.CROO_SIMULATE) {
    logger.error(
      "CROO_SIMULATE=false but --confirm-real-spend was not passed. Refusing to spend real USDC without explicit confirmation on THIS run.",
    );
    process.exitCode = 1;
    return;
  }

  let client: AgentClient;
  let correlator: OrderEventCorrelator;
  let closeStream: (() => void) | undefined;

  if (env.CROO_SIMULATE) {
    client = unusedStreamStub();
    correlator = new OrderEventCorrelator(unusedStreamStub());
  } else {
    if (!env.CROO_API_KEY) {
      logger.error("CROO_SIMULATE=false but CROO_API_KEY is not set. Refusing to attempt real calls.");
      process.exitCode = 1;
      return;
    }
    client = createCrooClient();
    const authed = await confirmAuth(client);
    logger.info(`Auth check (listOrders): ${authed ? "OK" : "FAILED"}`);
    if (!authed) {
      process.exitCode = 1;
      return;
    }
    const stream = await connectCrooEventStream(client);
    correlator = new OrderEventCorrelator(stream);
    closeStream = () => stream.close();
  }

  try {
    const result = await investigate({
      event,
      policy: RISK_POLICIES[policyName],
      client,
      correlator,
      repoUrl,
      packageName,
      npmHomepage,
      simulate: env.CROO_SIMULATE,
      simulatedHealthRaw: env.CROO_SIMULATE ? SIMULATED_HEALTHY_RAW : undefined,
      simulatedTrustRaw: env.CROO_SIMULATE ? SIMULATED_HIGH_RISK_REPORT : undefined,
      simulatedEscalationRaw: env.CROO_SIMULATE ? SIMULATED_THEMIS_REPORT : undefined,
    });

    if (!result.ok) {
      logger.error(`DEGRADED (FR-13): ${result.reason}`);
      logger.info("Partial lenses:", result.partialLenses);
      process.exitCode = 1;
      return;
    }

    logger.info("Pre-escalation (mergeResult):", result.mergeResult);
    logger.info("Final decision (quorum.decision.v1):", result.decision);
  } finally {
    closeStream?.();
  }
}

main().catch((err) => {
  logger.error("investigate script failed:", err);
  process.exitCode = 1;
});
