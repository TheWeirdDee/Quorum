import type { RepoListItem } from "../lib/types";

const POLICY_LABEL: Record<RepoListItem["risk_policy"], string> = {
  startup: "Startup",
  balanced: "Balanced",
  enterprise: "Enterprise",
};

export function RepoPanel({ repos }: { repos: RepoListItem[] }) {
  return (
    <div className="flex flex-col gap-2">
      {repos.map((repo) => (
        <div
          key={repo.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}
        >
          <div className="min-w-0">
            <a
              href={repo.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm font-medium underline decoration-dotted underline-offset-2"
              style={{ color: "var(--foreground)" }}
            >
              {repo.github_url.replace("https://github.com/", "")}
            </a>
            <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              {repo.dependencyCount} npm {repo.dependencyCount === 1 ? "dependency" : "dependencies"} monitored
              {repo.notify_type === "none" ? " · notifications off" : ""}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            <span className="rounded-full border px-2 py-0.5" style={{ borderColor: "var(--border-hairline)" }}>
              {POLICY_LABEL[repo.risk_policy]}
            </span>
            {repo.budget_cap_usdc !== null && <span className="tabular-nums">cap ${repo.budget_cap_usdc.toFixed(2)}/event</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
