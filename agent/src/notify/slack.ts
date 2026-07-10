import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { QuorumDecision } from "../decision/schema.js";

const DECISION_EMOJI: Record<QuorumDecision["decision"], string> = {
  SHIP: ":white_check_mark:",
  REVIEW: ":large_yellow_circle:",
  DO_NOT_SHIP: ":no_entry:",
  ARCHIVED_NO_ACTION: ":file_folder:",
};

/** Formats a quorum.decision.v1 as a single Slack message (FR-18, demo notifier). Exported so the dashboard/tests can preview the exact text without a network call. */
export function formatSlackMessage(decision: QuorumDecision): string {
  const emoji = DECISION_EMOJI[decision.decision];
  const lines = [
    `${emoji} *${decision.decision}* — \`${decision.dependency}\` (confidence ${(decision.confidence * 100).toFixed(0)}%)`,
    `Event: ${decision.event.type} (${decision.event.source}, ${decision.event.severity_hint}) — ${decision.gate.reason}`,
  ];

  if (decision.lenses.health) {
    lines.push(`Health (${decision.lenses.health.agent}): ${decision.lenses.health.verdict}`);
  }
  if (decision.lenses.trust) {
    lines.push(`Trust (${decision.lenses.trust.agent}): ${decision.lenses.trust.verdict}`);
  }
  if (decision.disagreement) {
    lines.push(`Disagreement: ${decision.disagreement}`);
  }
  if (decision.escalation.triggered) {
    lines.push(`Escalation: ${decision.escalation.agent ?? "?"} — ${decision.escalation.reason ?? ""}`);
  }
  lines.push(`Spend: $${decision.total_spend_usdc.toFixed(2)} · Receipts: ${decision.receipts.length}`);

  return lines.join("\n");
}

/**
 * Best-effort push of a decision to a Slack incoming webhook. Never throws:
 * a notify failure must not fail the pipeline that already spent real money
 * to produce the decision. Returns whether the push succeeded, for callers
 * that want to log/display it (never to gate anything on).
 *
 * `webhookUrl` defaults to env.SLACK_WEBHOOK_URL (the demo target); a
 * repo's own `notify.webhook` (captured at register time) is passed
 * explicitly by callers when set — an empty/undefined webhook is a silent
 * no-op, not an error, since "notify: none" is a valid registration choice.
 */
export async function notifySlack(decision: QuorumDecision, webhookUrl: string = env.SLACK_WEBHOOK_URL): Promise<boolean> {
  if (!webhookUrl) return false;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: formatSlackMessage(decision) }),
    });
    if (!res.ok) {
      logger.warn(`notifySlack: webhook returned ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("notifySlack: failed to reach webhook:", err);
    return false;
  }
}
