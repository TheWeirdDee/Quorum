import type { DecisionValue, LensVerdict } from "./types";

/** Status palette is fixed (never themed) — see dataviz skill references/palette.md. ARCHIVED_NO_ACTION isn't a good/warn/serious/critical outcome, so it gets a neutral (muted) treatment rather than borrowing one of the four reserved hues. */
export const DECISION_COLOR: Record<DecisionValue, string> = {
  SHIP: "var(--status-good)",
  REVIEW: "var(--status-warning)",
  DO_NOT_SHIP: "var(--status-critical)",
  ARCHIVED_NO_ACTION: "var(--text-muted)",
};

export const DECISION_LABEL: Record<DecisionValue, string> = {
  SHIP: "Ship",
  REVIEW: "Review",
  DO_NOT_SHIP: "Do not ship",
  ARCHIVED_NO_ACTION: "Archived",
};

/** Health and trust verdicts both collapse to the same good/warn/critical status scale — they ARE status indicators (this dependency's health/trust state), not arbitrary categorical series. */
export const VERDICT_COLOR: Record<LensVerdict, string> = {
  healthy: "var(--status-good)",
  trusted: "var(--status-good)",
  mixed: "var(--status-warning)",
  caution: "var(--status-warning)",
  unhealthy: "var(--status-critical)",
  high_risk: "var(--status-critical)",
};
