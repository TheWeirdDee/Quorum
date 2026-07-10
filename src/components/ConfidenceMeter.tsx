import { DECISION_COLOR } from "../lib/decisionColor";
import type { DecisionValue } from "../lib/types";

/** Meter / progress track (dataviz skill Tier 1): a single magnitude, fill colored by the decision it supports rather than an unrelated hue — ties "how confident" back to "confident in what". */
export function ConfidenceMeter({ confidence, decision }: { confidence: number; decision: DecisionValue }) {
  const pct = Math.round(confidence * 100);
  const color = DECISION_COLOR[decision];
  return (
    <div className="flex items-center gap-2" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Confidence">
      <div className="h-2 flex-1 min-w-16 rounded-full" style={{ backgroundColor: "var(--gridline)" }}>
        <div className="h-2 rounded-full transition-[width]" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-11 shrink-0 text-right text-xs font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>
        {pct}%
      </span>
    </div>
  );
}
