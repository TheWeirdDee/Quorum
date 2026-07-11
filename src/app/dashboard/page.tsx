"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DecisionCard } from "../../components/DecisionCard";
import { EmptyState } from "../../components/EmptyState";
import { RepoPanel } from "../../components/RepoPanel";
import { StatTile } from "../../components/StatTile";
import { TrustTrajectory } from "../../components/TrustTrajectory";
import { DEMO_INITIAL_DECISIONS, DEMO_REPOS, DEMO_REVEALS } from "../../lib/demoData";
import type { DecisionListItem, RepoListItem } from "../../lib/types";

const POLL_MS = 4000;

export default function DashboardPage() {
  const [decisions, setDecisions] = useState<DecisionListItem[] | null>(null);
  const [repos, setRepos] = useState<RepoListItem[] | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // ?demo=true — the recorded-demo surface: seeded data replayed on a
    // timer (the $0 archive story first, then the real mainnet run, then
    // the DO_NOT_SHIP climax), never touching the live API. Read off
    // window.location rather than useSearchParams so the page keeps
    // prerendering statically without a Suspense boundary.
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (demo === "true" || demo === "1") {
      setDemoMode(true);
      setRepos(DEMO_REPOS);
      setDecisions(DEMO_INITIAL_DECISIONS);
      const timers = DEMO_REVEALS.map(({ afterMs, decision }) =>
        setTimeout(() => setDecisions((prev) => [decision, ...(prev ?? [])]), afterMs),
      );
      return () => timers.forEach(clearTimeout);
    }

    async function load() {
      try {
        const [decisionsRes, reposRes] = await Promise.all([fetch("/api/decisions?limit=50"), fetch("/api/repos")]);
        // Both routes always return valid JSON now, even on failure — a
        // fetch() that resolves at all (2xx or not) should be parsed, not
        // treated as a network error, or a real "the data source is
        // unreachable" condition would silently look identical to success.
        const decisionsJson = (await decisionsRes.json()) as { decisions: DecisionListItem[]; error?: string };
        const reposJson = (await reposRes.json()) as { repos: RepoListItem[]; error?: string };
        if (cancelled) return;

        const err = decisionsJson.error ?? reposJson.error ?? null;
        setSourceError(err);
        setDecisions(decisionsJson.decisions);
        setRepos(reposJson.repos);
      } catch {
        // A genuine network-level failure (e.g. dev server mid-reload) — the
        // next poll tick retries; only surface an error once we've never
        // successfully loaded anything, so a real outage is visible but a
        // one-off blip after a successful load doesn't flash an error.
        if (!cancelled && decisions === null && repos === null) {
          setSourceError("Could not reach the dashboard's API routes.");
        }
      }
    }

    void load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once; the closure reads decisions/repos only to decide whether an error is worth surfacing, not to resubscribe on every data change
  }, []);

  const totalSpend = (decisions ?? []).reduce((sum, d) => sum + d.total_spend_usdc, 0);
  const investigatedCount = (decisions ?? []).filter((d) => d.payload.gate.investigated).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Header />

      {demoMode && (
        <div
          className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
          style={{
            borderColor: "var(--status-warning)",
            backgroundColor: "color-mix(in srgb, var(--status-warning) 10%, transparent)",
            color: "var(--text-secondary)",
          }}
        >
          <span>
            <strong style={{ color: "var(--foreground)" }}>Demo mode</strong> — seeded data replaying the demo
            scenario. The node-ipc REVIEW card is a real mainnet run with real receipts; SIMULATED entries are fixtures.
          </span>
          {/* Plain anchor (full reload), not <Link>: the demo/live switch happens in a mount-once effect, so a client-side nav to the same route wouldn't reset it. */}
          <a href="/dashboard" className="text-xs underline decoration-dotted underline-offset-2">
            exit
          </a>
        </div>
      )}

      {sourceError && (
        <div
          className="mt-6 rounded-lg border p-3 text-sm"
          style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", backgroundColor: "color-mix(in srgb, var(--status-critical) 8%, transparent)" }}
        >
          <strong>Can&apos;t reach the data source.</strong> {sourceError} — if this dashboard is deployed separately
          from the worker, confirm <code>QUORUM_AGENT_API_URL</code> / <code>QUORUM_AGENT_API_KEY</code> are set (see
          DEPLOY.md §3).
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Registered repos" value={repos ? String(repos.length) : "–"} />
        <StatTile label="Events processed" value={decisions ? String(decisions.length) : "–"} />
        <StatTile label="Investigated" value={decisions ? String(investigatedCount) : "–"} />
        <StatTile label="Total spend" value={`$${totalSpend.toFixed(2)}`} />
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Monitored repos
        </h2>
        <div className="mt-3">
          {repos === null ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading…
            </p>
          ) : repos.length === 0 ? (
            <EmptyState message="No repos registered yet. Register one over CAP (quorum.register) or run the worker against a seeded fixture." />
          ) : (
            <RepoPanel repos={repos} />
          )}
        </div>
      </section>

      <TrustTrajectory decisions={decisions ?? []} />

      <section className="mt-8 flex-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          Event feed
        </h2>
        <div className="mt-3 flex flex-col gap-3">
          {decisions === null ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading…
            </p>
          ) : decisions.length === 0 ? (
            <EmptyState message="No decisions yet. Once a repo is registered and a trust event fires, it appears here live." />
          ) : (
            decisions.map((d) => <DecisionCard key={d.id} decision={d.payload} />)
          )}
        </div>
      </section>

      <footer className="mt-10 pb-2 text-center text-xs" style={{ color: "var(--text-muted)" }}>
        Live view, polling every {POLL_MS / 1000}s — CAP receipts link out to Basescan (Base mainnet).
      </footer>
    </div>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static local SVG; next/image adds no value here */}
        <img src="/logo.svg" alt="" width={40} height={40} className="rounded-lg" />
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--foreground)" }}>
            Quorum
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Autonomous trust broker for your software supply chain
          </p>
        </div>
      </div>
      <Link href="/" className="text-xs underline decoration-dotted underline-offset-2" style={{ color: "var(--text-muted)" }}>
        ← Home
      </Link>
    </header>
  );
}
