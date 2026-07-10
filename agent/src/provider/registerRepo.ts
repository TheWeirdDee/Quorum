import type { AgentClient } from "@croo-network/sdk";
import type Database from "better-sqlite3";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getRiskPolicy } from "../config/riskPolicy.js";
import type { OrderEventCorrelator } from "../croo/orderCorrelator.js";
import type { QuorumDecision } from "../decision/schema.js";
import { serializeDecision } from "../decision/serialize.js";
import { pollRepoForNewEvents } from "../detector/index.js";
import { resolveNpmDependencies } from "../detector/sources/github.js";
import { riskGate } from "../gate/riskGate.js";
import { notifySlack } from "../notify/slack.js";
import { persistDecisionAndOrders, processEvent } from "../orchestrate/processEvent.js";
import { upsertDependency } from "../store/dependencies.js";
import { upsertRepo, type RepoRecord } from "../store/repos.js";
import type { QuorumRequest } from "./requestSchema.js";

export interface RunBaselineScanParams {
  db: Database.Database;
  client: AgentClient;
  correlator: OrderEventCorrelator;
  request: QuorumRequest;
  simulate?: boolean | undefined;
  simulatedHealthRaw?: unknown;
  simulatedTrustRaw?: unknown;
  simulatedEscalationRaw?: unknown;
}

export interface BaselineScanResult {
  decision: QuorumDecision;
  repo: RepoRecord;
  dependencyCount: number;
}

function repoSlug(githubUrl: string): string {
  return githubUrl.replace(/^https:\/\/github\.com\//, "").replace(/\/+$/, "");
}

/**
 * Resolves the repo's stored notify config at registration time (FR-1, §3):
 * omitted `notify` -> defaults to the demo Slack webhook (env), so FR-18
 * works out of the box; explicit `{ type: "none" }` -> never notify, no
 * fallback; explicit webhook always wins over the env default.
 */
function resolveNotify(request: QuorumRequest): { notifyType: string; notifyWebhook: string | undefined } {
  if (request.notify?.type === "none") return { notifyType: "none", notifyWebhook: undefined };
  return { notifyType: "slack", notifyWebhook: request.notify?.webhook ?? (env.SLACK_WEBHOOK_URL || undefined) };
}

/**
 * FR-4: on order_paid, register the repo, index its npm dependencies
 * (PRD N2 — only npm runs the full pipeline; other requested ecosystems are
 * accepted but not indexed here), run one detection sweep over them, and
 * deliver exactly ONE quorum.decision.v1 — either a real investigated
 * decision for the first admitted event the Risk Gate says is worth paying
 * for, or an honest "nothing to report yet" baseline decision.
 *
 * Only ONE candidate event is investigated here even if several are found
 * at registration (real CAP spend for each would be surprising on a single
 * register call) — whichever succeeds first; any others are left admitted
 * in `seen_events` un-investigated is NOT what happens: they were already
 * marked seen by pollRepoForNewEvents before this function chooses among
 * them (see the poll-loop-reuse note below), so a failed/skipped candidate
 * will NOT be retried by a later poll cycle. Documented simplification,
 * not silently accepted: acceptable at registration volume (one order),
 * matching this codebase's existing no-retry disclosures (SDK_NOTES.md
 * items 15, 21) rather than building a bespoke re-admission path for a
 * case that in practice is at most a handful of events on a single repo.
 */
export async function runBaselineScan(params: RunBaselineScanParams): Promise<BaselineScanResult> {
  const { db, request } = params;
  const { notifyType, notifyWebhook } = resolveNotify(request);

  const repo = upsertRepo(db, {
    githubUrl: request.repo,
    riskPolicy: request.risk_policy,
    notifyType,
    ...(request.budget_cap_usdc !== undefined ? { budgetCapUsdc: request.budget_cap_usdc } : {}),
    ...(notifyWebhook !== undefined ? { notifyWebhook } : {}),
  });

  let dependencyCount = 0;
  if (request.ecosystems.includes("npm")) {
    const deps = await resolveNpmDependencies(request.repo);
    if (deps) {
      for (const dep of deps) {
        upsertDependency(db, { repoId: repo.id, name: dep.name, version: dep.version, isProduction: dep.isProduction });
      }
      dependencyCount = deps.length;
    } else {
      logger.warn(`runBaselineScan: no package.json found at ${request.repo} — registered with 0 indexed npm dependencies`);
    }
  }

  const admitted =
    dependencyCount > 0 ? await pollRepoForNewEvents(db, repo.id, request.repo, env.BASELINE_SCAN_MAX_DEPS) : [];

  const policy = getRiskPolicy(
    request.risk_policy,
    request.budget_cap_usdc !== undefined ? { budgetCapUsdc: request.budget_cap_usdc } : {},
  );
  const investigable = admitted.filter((event) => riskGate(event, policy).investigated);

  for (const event of investigable) {
    const result = await processEvent({
      db,
      client: params.client,
      correlator: params.correlator,
      repo,
      event,
      simulate: params.simulate,
      simulatedHealthRaw: params.simulatedHealthRaw,
      simulatedTrustRaw: params.simulatedTrustRaw,
      simulatedEscalationRaw: params.simulatedEscalationRaw,
    });
    if (result.ok) {
      return { decision: result.decision, repo, dependencyCount };
    }
    logger.warn(`runBaselineScan: ${event.dependency} degraded at registration (${result.reason}) — trying the next candidate, if any`);
  }

  const degradedCount = investigable.length;
  const decision = serializeDecision({
    investigated: false,
    dependency: `${repoSlug(request.repo)}@registration`,
    event: {
      type: "baseline_scan",
      detail:
        `Registered ${request.repo}; indexed ${dependencyCount} npm dependencies.` +
        (degradedCount > 0
          ? ` ${degradedCount} candidate event(s) found but could not be independently verified at registration.`
          : " No investigatable trust events found."),
      source: "system",
      ref: request.repo,
      severity_hint: "info",
    },
    gateReason:
      degradedCount > 0
        ? "candidate event(s) found but verification failed at registration"
        : "no investigatable trust events at registration",
  });

  persistDecisionAndOrders(db, undefined, decision);
  if (notifyType !== "none") await notifySlack(decision, notifyWebhook);
  return { decision, repo, dependencyCount };
}
