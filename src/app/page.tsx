"use client";

import { useEffect, useState } from "react";
import { DecisionCard } from "../components/DecisionCard";
import { EmptyState } from "../components/EmptyState";
import { RepoPanel } from "../components/RepoPanel";
import { StatTile } from "../components/StatTile";
import type { DecisionListItem, RepoListItem } from "../lib/types";

const POLL_MS = 4000;

export default function DashboardPage() {
  const [decisions, setDecisions] = useState<DecisionListItem[] | null>(null);
  const [repos, setRepos] = useState<RepoListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [decisionsRes, reposRes] = await Promise.all([fetch("/api/decisions?limit=50"), fetch("/api/repos")]);
        const decisionsJson = (await decisionsRes.json()) as { decisions: DecisionListItem[] };
        const reposJson = (await reposRes.json()) as { repos: RepoListItem[] };
        if (!cancelled) {
          setDecisions(decisionsJson.decisions);
          setRepos(reposJson.repos);
        }
      } catch {
        // Transient fetch failure (e.g. dev server mid-reload) — the next poll tick retries; keep showing the last known state rather than clearing it.
      }
    }

    void load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const totalSpend = (decisions ?? []).reduce((sum, d) => sum + d.total_spend_usdc, 0);
  const investigatedCount = (decisions ?? []).filter((d) => d.payload.gate.investigated).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Header />

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
    <header className="flex items-center gap-3">
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
    </header>
  );
}
