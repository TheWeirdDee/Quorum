import { VERDICT_COLOR } from "../lib/decisionColor";
import type { LensVerdict } from "../lib/types";

export function LensBadge({ verdict }: { verdict: LensVerdict }) {
  const color = VERDICT_COLOR[verdict];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color }}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {verdict.replace("_", " ")}
    </span>
  );
}
