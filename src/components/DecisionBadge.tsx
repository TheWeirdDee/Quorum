import { DECISION_COLOR, DECISION_LABEL } from "../lib/decisionColor";
import type { DecisionValue } from "../lib/types";

const ICON: Record<DecisionValue, string> = {
  SHIP: "✓",
  REVIEW: "!",
  DO_NOT_SHIP: "✕",
  ARCHIVED_NO_ACTION: "–",
};

/** A status badge is never color-alone (dataviz skill): icon + label always ship together, color is the reinforcing channel. */
export function DecisionBadge({ decision }: { decision: DecisionValue }) {
  const color = DECISION_COLOR[decision];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide"
      style={{
        color,
        border: `1px solid ${color}`,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <span aria-hidden>{ICON[decision]}</span>
      {DECISION_LABEL[decision]}
    </span>
  );
}
