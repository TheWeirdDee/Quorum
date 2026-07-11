import { DECISION_COLOR, DECISION_LABEL } from "../lib/decisionColor";
import type { DecisionListItem } from "../lib/types";

/** "node-ipc@9.2.1" -> "node-ipc"; scoped packages split at the LAST @ (mirrors the agent's packageNameFromDependency). */
function packageOf(dependency: string): string {
  const at = dependency.lastIndexOf("@");
  return at > 0 ? dependency.slice(0, at) : dependency;
}

interface Trajectory {
  pkg: string;
  /** Chronological, oldest first. */
  items: DecisionListItem[];
}

/**
 * Memory made visible: when the same dependency has been decided more than
 * once, show the movement — trust is a trajectory, not a snapshot. Renders
 * nothing until some package genuinely has ≥2 decisions, so a fresh install
 * carries no empty section. Baseline registration scans are excluded; they
 * describe a repo, not a dependency's trust.
 */
export function TrustTrajectory({ decisions }: { decisions: DecisionListItem[] }) {
  const groups = new Map<string, DecisionListItem[]>();
  for (const decision of decisions) {
    if (decision.payload.event.type === "baseline_scan") continue;
    const pkg = packageOf(decision.payload.dependency);
    const list = groups.get(pkg) ?? [];
    list.push(decision);
    groups.set(pkg, list);
  }

  const trajectories: Trajectory[] = [...groups.entries()]
    .map(([pkg, items]) => ({ pkg, items: [...items].sort((a, b) => a.decided_at.localeCompare(b.decided_at)) }))
    .filter((t) => t.items.length >= 2);

  if (trajectories.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        Trust trajectories
      </h2>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Dependencies Quorum has decided on more than once — trust is a trajectory, not a snapshot.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {trajectories.map(({ pkg, items }) => {
          const last = items[items.length - 1];
          const prev = items[items.length - 2];
          const deltaPts = Math.round((last.confidence - prev.confidence) * 100);
          return (
            <div
              key={pkg}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3"
              style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}
            >
              <span className="font-mono text-sm font-medium" style={{ color: "var(--foreground)" }}>
                {pkg}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                {items.map((item, i) => {
                  const color = DECISION_COLOR[item.decision];
                  return (
                    <span key={item.id} className="flex items-center gap-2">
                      {i > 0 && (
                        <span aria-hidden style={{ color: "var(--text-muted)" }}>
                          →
                        </span>
                      )}
                      <span
                        className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                        style={{ color, borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
                        title={new Date(item.decided_at).toLocaleString()}
                      >
                        {DECISION_LABEL[item.decision]} {Math.round(item.confidence * 100)}%
                      </span>
                    </span>
                  );
                })}
              </span>
              {deltaPts !== 0 && (
                <span className="ml-auto text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                  Δ {deltaPts > 0 ? "+" : ""}
                  {deltaPts} pts since {new Date(prev.decided_at).toLocaleDateString()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
