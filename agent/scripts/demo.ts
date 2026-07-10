/**
 * Demo harness (SPEC §8): runs the seeded fixtures through investigate()
 * end to end and prints a human-readable timeline — the contrast event
 * (archived, $0) first, then the malicious_release full pipeline, now
 * including the M4 escalation step: confidence climbing as the tiebreaker
 * resolves the health/trust disagreement.
 *
 * Two modes:
 *   npm run demo                                    fixtures mode (default) — fully
 *                                                     offline, $0, deterministic. Safe
 *                                                     to run as many times as you want
 *                                                     while rehearsing.
 *   npm run demo -- --real --confirm-real-spend
 *       --repo=<github-url> --package=<npm-name>      REAL mode — actual CAP hires,
 *                                                     real USDC. Requires CROO_SIMULATE=
 *                                                     false in agent/.env. --repo/--package
 *                                                     are required in this mode: the
 *                                                     seeded fixture's "evil-dep" /
 *                                                     "acme/evil-dep" are fictional and
 *                                                     don't exist for a real agent to
 *                                                     analyze — point this at something
 *                                                     real for the live demo. Note:
 *                                                     ESCALATION_AGENT_SERVICE_ID is left
 *                                                     empty until a live counterparty is
 *                                                     confirmed, so real mode will show the
 *                                                     graceful-degrade path for escalation
 *                                                     until that's set.
 */
import type { AgentClient, EventTypeName } from "@croo-network/sdk";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";
import { connectCrooEventStream, confirmAuth, createCrooClient } from "../src/croo/client.js";
import { OrderEventCorrelator } from "../src/croo/orderCorrelator.js";
import { RISK_POLICIES, type RiskPolicyName } from "../src/config/riskPolicy.js";
import { loadFixtureEvents } from "../src/detector/index.js";
import type { TrustEvent } from "../src/detector/types.js";
import { investigate } from "../src/orchestrate/investigate.js";

const args = process.argv.slice(2);
const REAL = args.includes("--real");
const CONFIRMED = args.includes("--confirm-real-spend");

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function unusedStreamStub() {
  return { on: (_eventType: EventTypeName | string, _handler: (event: never) => void) => undefined } as never;
}

function line(text = ""): void {
  // eslint-disable-next-line no-console
  console.log(text);
}
function divider(): void {
  line("─".repeat(70));
}
function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
function contextString(event: TrustEvent, key: string): string | undefined {
  const value = event.context?.[key];
  return typeof value === "string" ? value : undefined;
}
function packageNameOf(dependency: string): string {
  return dependency.split("@").slice(0, dependency.startsWith("@") ? 2 : 1).join("@");
}

/** Realistic-shaped simulate fixtures (SDK_NOTES.md items 12, 19) — deterministic verdicts for a rehearsable demo. */
const SIMULATED_HEALTHY_RAW = {
  overall_score: 82,
  readme_quality: { score: 78, comment: "Clear docs." },
  test_coverage_signal: { score: 74, comment: "Tests present." },
  dependency_health: { score: 88, comment: "1 outdated dependency." },
  maintenance_activity: { score: 90, comment: "Active commits." },
  recommendations: ["Add coverage reporting."],
};
const SIMULATED_HIGH_RISK_REPORT = [
  "VERIS TRUST REPORT",
  "Subject:          evil-dep",
  "LEGITIMACY:   22/100",
  "RECOMMENDATION:  ⛔ CRITICAL RISK  [Band: 0-29]",
].join("\n");
// score 0.075 blended with the pre-escalation confidence (0.60) lands at
// exactly 0.94: decisiveness=|0.075-0.5|*2=0.85; 0.60+(1-0.60)*0.85=0.94.
const SIMULATED_THEMIS_REPORT = [
  "THEMIS FACT-CHECK",
  "",
  "Confidence: 0.075",
  "",
  "The postinstall script added in 2.4.1 was verified to run `curl` piping process.env",
  "to an external host — matches a known exfiltration pattern. Could not verify this",
  "is safe to ship.",
].join("\n");

async function runArchivedContrast(
  events: TrustEvent[],
  client: AgentClient,
  correlator: OrderEventCorrelator,
  simulate: boolean,
): Promise<void> {
  const patchEvent = events.find((e) => e.type === "deprecation");
  if (!patchEvent) return;

  divider();
  line("CONTRAST — a low-severity event, shown first, so the $0 line means something later:");
  line();
  line(`Event Detector: "${patchEvent.dependency}" — ${patchEvent.type}, ${patchEvent.severity_hint} severity`);

  const result = await investigate({
    event: patchEvent,
    policy: RISK_POLICIES.balanced,
    client,
    correlator,
    repoUrl: contextString(patchEvent, "repo") ?? "",
    packageName: packageNameOf(patchEvent.dependency),
    simulate,
  });

  if (result.ok) {
    line(`RISK GATE: "${result.decision.gate.reason}"`);
    line(`→ ${result.decision.decision}. Cost: ${money(result.decision.total_spend_usdc)}. No agents hired.`);
  }
  line();
}

async function runMaliciousScenario(params: {
  events: TrustEvent[];
  policyName: RiskPolicyName;
  client: AgentClient;
  correlator: OrderEventCorrelator;
  simulate: boolean;
  repoUrl: string;
  packageName: string;
  npmHomepage: string | undefined;
}): Promise<void> {
  const { events, policyName, client, correlator, simulate, repoUrl, packageName, npmHomepage } = params;
  const maliciousEvent = events.find((e) => e.type === "malicious_release");
  if (!maliciousEvent) {
    logger.error("No malicious_release event found in fixtures/events/");
    return;
  }
  const policy = RISK_POLICIES[policyName];

  divider();
  line(`Event Detector: malicious version published — ${maliciousEvent.dependency}`);
  line(
    `  → TrustEvent { type: ${maliciousEvent.type}, severity: ${maliciousEvent.severity_hint}, source: ${maliciousEvent.source} }`,
  );
  line();

  line(`CAP ORDER → Repo Doctor   (hiring...)`);
  line(`CAP ORDER → VERIS         (hiring...)`);
  line();

  const result = await investigate({
    event: maliciousEvent,
    policy,
    client,
    correlator,
    repoUrl,
    packageName,
    npmHomepage,
    simulate,
    simulatedHealthRaw: simulate ? SIMULATED_HEALTHY_RAW : undefined,
    simulatedTrustRaw: simulate ? SIMULATED_HIGH_RISK_REPORT : undefined,
    simulatedEscalationRaw: simulate ? SIMULATED_THEMIS_REPORT : undefined,
  });

  if (!result.ok) {
    line(`✗ DEGRADED (FR-13 — never fabricates a decision it can't support): ${result.reason}`);
    if (result.partialLenses.health) {
      line(`  Repo Doctor DID respond: ${result.partialLenses.health.verdict}`);
    }
    if (result.partialLenses.trust) {
      line(`  VERIS DID respond: ${result.partialLenses.trust.verdict}`);
    }
    return;
  }

  const d = result.decision;
  line(`RISK GATE: "${d.gate.reason}" → investigating.`);
  line();

  if (d.lenses.health) {
    line(
      `Repo Doctor: ${d.lenses.health.verdict.toUpperCase().padEnd(10)} tx=${d.lenses.health.tx ?? "(n/a)"}  cost=${money(d.lenses.health.cost_usdc ?? 0)}`,
    );
  }
  if (d.lenses.trust) {
    line(
      `VERIS:       ${d.lenses.trust.verdict.toUpperCase().padEnd(10)} tx=${d.lenses.trust.tx ?? "(n/a)"}  cost=${money(d.lenses.trust.cost_usdc ?? 0)}`,
    );
  }
  line();

  const preDecision = result.mergeResult?.decision ?? d.decision;
  const preConfidence = result.mergeResult?.confidence ?? d.confidence;
  const preDisagreement = result.mergeResult?.disagreement ?? "";
  const needsEscalation = result.mergeResult?.needs_escalation ?? false;

  if (preDisagreement) {
    line(`→ DISAGREEMENT. Confidence ${preConfidence.toFixed(2)}.`);
    line(`  ${preDisagreement}`);
  } else {
    line(`→ AGREEMENT. Confidence ${preConfidence.toFixed(2)}.`);
  }
  line();

  const preSpend = (d.lenses.health?.cost_usdc ?? 0) + (d.lenses.trust?.cost_usdc ?? 0);
  const budgetRemaining = policy.budget_cap_usdc - preSpend;
  line(
    `${policy.name.toUpperCase()} POLICY: target ${policy.confidence_target.toFixed(2)} ${needsEscalation ? ">" : "<="} confidence ${preConfidence.toFixed(2)}, budget remaining ${money(budgetRemaining)}.`,
  );

  if (needsEscalation) {
    const escalated = d.escalation.triggered && d.confidence !== preConfidence;
    if (escalated) {
      line(`→ autonomously purchases escalation from Themis (Fact-Check)   tx=${d.escalation.tx ?? "(n/a)"}   cost=${money(d.escalation.cost_usdc ?? 0)}`);
      // d.disagreement is preDisagreement + " Escalation (Themis): <review>" once resolved — pull just the review back out for display.
      if (d.disagreement.startsWith(preDisagreement)) {
        const suffix = d.disagreement.slice(preDisagreement.length).replace(/^\s*Escalation \(Themis\):\s*/, "");
        if (suffix) line(`  Themis: ${suffix}`);
      }
      line();
      line(`Confidence ${preConfidence.toFixed(2)} → ${d.confidence.toFixed(2)}.  DECISION: ${preDecision} → ${d.decision}.`);
    } else {
      line(`→ escalation ${d.escalation.triggered ? "attempted but unresolved" : "skipped"}: ${d.escalation.reason ?? "(no reason recorded)"}`);
      line();
      line(`DECISION: ${d.decision} (unchanged — honest confidence, no fabrication). Confidence ${d.confidence.toFixed(2)}.`);
    }
  } else {
    line(`→ needs_escalation = false — confidence already meets target, no escalation purchased.`);
    line();
    line(`DECISION: ${d.decision}.  Confidence ${d.confidence.toFixed(2)}.`);
  }
  line();

  line(`Total spend: ${money(d.total_spend_usdc)}.  Receipts: [${d.receipts.join(", ") || "none"}]`);
  line(`Notifier: not yet built — decision would be pushed to Slack here (FR-18, later milestone).`);
  line();
}

async function main(): Promise<void> {
  const policyName = (argValue("policy") as RiskPolicyName | undefined) ?? "enterprise";
  const events = loadFixtureEvents();

  if (!REAL) {
    line("=".repeat(70));
    line("QUORUM DEMO — fixtures mode (offline, $0, deterministic)");
    line("=".repeat(70));
    const correlator = new OrderEventCorrelator(unusedStreamStub());
    const client = unusedStreamStub();
    await runArchivedContrast(events, client, correlator, true);
    await runMaliciousScenario({
      events,
      policyName,
      client,
      correlator,
      simulate: true,
      repoUrl: "https://github.com/acme/evil-dep",
      packageName: "evil-dep",
      npmHomepage: "https://www.npmjs.com/package/evil-dep",
    });
    divider();
    return;
  }

  // ── Real mode ──
  if (!CONFIRMED) {
    logger.error("--real requires --confirm-real-spend as well. Refusing to spend real USDC without explicit confirmation.");
    process.exitCode = 1;
    return;
  }
  if (env.CROO_SIMULATE) {
    logger.error("--real was passed but CROO_SIMULATE=true in agent/.env. Set CROO_SIMULATE=false to actually spend.");
    process.exitCode = 1;
    return;
  }
  const repoUrl = argValue("repo");
  const packageName = argValue("package");
  if (!repoUrl || !packageName) {
    logger.error(
      "Real mode requires --repo=<github-url> --package=<npm-name>. " +
        "The seeded fixture's 'evil-dep' / 'acme/evil-dep' are fictional and won't resolve against a real agent.",
    );
    process.exitCode = 1;
    return;
  }
  if (!env.CROO_API_KEY) {
    logger.error("CROO_API_KEY is not set. Refusing to attempt a real call.");
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
    line("=".repeat(70));
    line("QUORUM DEMO — REAL mode (actual CAP hires, real USDC)");
    line("=".repeat(70));
    await runArchivedContrast(events, client, correlator, false);
    await runMaliciousScenario({
      events,
      policyName,
      client,
      correlator,
      simulate: false,
      repoUrl,
      packageName,
      npmHomepage: undefined,
    });
    divider();
  } finally {
    stream.close();
  }
}

main().catch((err) => {
  logger.error("demo script failed:", err);
  process.exitCode = 1;
});
