"use client";

import { useState } from "react";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { DecisionBadge } from "./DecisionBadge";
import { LensBadge } from "./LensBadge";
import { TxLink } from "./TxLink";
import type { LensResult, QuorumDecision } from "../lib/types";

function LensCard({ role, lens }: { role: "health" | "trust"; lens: LensResult }) {
  return (
    <div className="rounded border p-2" style={{ borderColor: "var(--border-hairline)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {lens.agent} <span style={{ color: "var(--text-muted)" }}>({role})</span>
        </span>
        <LensBadge verdict={lens.verdict} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <TxLink tx={lens.tx} />
        {lens.cost_usdc !== undefined && (
          <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
            ${lens.cost_usdc.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

export function DecisionCard({ decision }: { decision: QuorumDecision }) {
  const { event, gate, lenses, escalation, disagreement, total_spend_usdc, receipts } = decision;
  const hasLenses = Boolean(lenses.health || lenses.trust);
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      className="cursor-pointer rounded-lg border p-4 transition-shadow hover:shadow-sm"
      style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}
      onClick={(e) => {
        // Links inside the card (Basescan receipts, repo links) must keep
        // working as links — only plain card clicks toggle the deliverable.
        if ((e.target as HTMLElement).closest("a")) return;
        setExpanded((v) => !v);
      }}
      aria-expanded={expanded}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-medium" style={{ color: "var(--foreground)" }}>
            {decision.dependency}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {event.type} · {event.severity_hint} · via {event.source} · {new Date(decision.decided_at).toLocaleString()}
          </div>
        </div>
        <DecisionBadge decision={decision.decision} />
      </div>

      <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
        {gate.reason}
      </p>

      {hasLenses && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {lenses.health && <LensCard role="health" lens={lenses.health} />}
          {lenses.trust && <LensCard role="trust" lens={lenses.trust} />}
        </div>
      )}

      {disagreement && (
        <div
          className="mt-3 rounded-r border-l-2 p-2 text-xs"
          style={{
            borderColor: "var(--accent-violet)",
            backgroundColor: "color-mix(in srgb, var(--accent-violet) 8%, transparent)",
            color: "var(--text-secondary)",
          }}
        >
          <span className="font-semibold" style={{ color: "var(--accent-violet)" }}>
            Disagreement —{" "}
          </span>
          {disagreement}
        </div>
      )}

      {escalation.triggered && (
        <div
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-r border-l-2 p-2 text-xs"
          style={{ borderColor: "var(--accent-violet)" }}
        >
          <span style={{ color: "var(--text-secondary)" }}>
            <span className="font-semibold" style={{ color: "var(--accent-violet)" }}>
              Escalation{escalation.agent ? ` — ${escalation.agent}` : ""}:
            </span>{" "}
            {escalation.reason}
          </span>
          <TxLink tx={escalation.tx} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-4">
        <div className="max-w-56 flex-1">
          <ConfidenceMeter confidence={decision.confidence} decision={decision.decision} />
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
          ${total_spend_usdc.toFixed(2)} · {receipts.length} receipt{receipts.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-2 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
        {expanded ? "▴ hide full deliverable" : "▾ click to view the full deliverable"}
      </div>

      {expanded && (
        <div className="mt-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            quorum.decision.v1 — the exact object delivered to the buyer
          </div>
          <pre
            className="mt-1.5 max-h-96 overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed"
            style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--background)", color: "var(--text-secondary)" }}
          >
            {JSON.stringify(decision, null, 2)}
          </pre>
        </div>
      )}
    </article>
  );
}
