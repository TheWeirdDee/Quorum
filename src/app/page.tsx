import Link from "next/link";
import { Drift, Reveal, SmoothScroll } from "../components/motion";

const GITHUB_URL = "https://github.com/TheWeirdDee/Quorum";
const STORE_URL = "https://agent.croo.network/agents/f6e61f10-a81c-4916-9791-4eab77ac2418";

const STATS = [
  { value: "$0", label: "cost when nothing happens" },
  { value: "2", label: "independent lenses per event" },
  { value: "1", label: "tiebreaker, bought only on disagreement" },
  { value: "100%", label: "of opinions settled on-chain" },
];

const PILLARS = [
  {
    title: "It watches",
    body: "Register a repo once. Quorum indexes its npm dependency tree and polls OSV, GitHub and the npm registry for eight kinds of trust events — malicious releases, new CVEs, maintainer changes, abandonment, license flips — deduped so each one fires exactly once.",
  },
  {
    title: "It gates every dollar",
    body: "Before any money moves, a deterministic Risk Gate asks: is this event worth paying to investigate? Patch releases and low-severity noise archive at $0, and the gate's reasoning is recorded either way. Most events cost you nothing.",
  },
  {
    title: "It buys certainty",
    body: "When its hired experts disagree — or confidence lands below your policy's target — Quorum autonomously purchases one more independent opinion to resolve the conflict, bounded by a hard budget cap. It even refuses over-priced quotes on its own.",
  },
];

const STEPS = [
  { title: "Register a repo, once", body: "Point Quorum at a GitHub repo and pick a risk policy. It indexes the dependency tree and starts watching." },
  { title: "A trust event fires", body: "A malicious release, a fresh CVE, a maintainer handover — detected, normalized, deduped." },
  { title: "The Risk Gate decides to spend", body: "Noise archives at $0. Real signals — critical advisories on production dependencies — get investigated." },
  { title: "Two independent agents are hired", body: "Repo Doctor: “is this technically healthy?” VERIS: “is this publisher trustworthy?” Paid in USDC over CAP, live." },
  { title: "Disagreement triggers a tiebreak", body: "Healthy code from an untrustworthy publisher? Quorum buys one fact-check to settle it — only when justified." },
  { title: "You get a decision", body: "SHIP, REVIEW or DO_NOT_SHIP — with confidence, the disagreement in plain English, and every on-chain receipt." },
];

const POLICIES = [
  { name: "startup", target: "0.70", cap: "$0.05", posture: "Minimize spend; alert only on clear high risk." },
  { name: "balanced", target: "0.80", cap: "$0.15", posture: "The default. Escalate on disagreement." },
  { name: "enterprise", target: "0.90", cap: "$0.25", posture: "Buy certainty before alerting." },
];

const COMPARISON = [
  { row: "Answers", quorum: "Should I keep shipping this in production?", repoDoctor: "Is this repo technically healthy?", veris: "Is this publisher trustworthy?" },
  { row: "Output", quorum: "Decision + confidence + receipts", repoDoctor: "Report", veris: "Report" },
  { row: "Trigger", quorum: "Autonomous, event-driven", repoDoctor: "On demand", veris: "On demand" },
  { row: "Spends money", quorum: "Yes — only when justified", repoDoctor: "No", veris: "No" },
];

const REQUEST_JSON = `{
  "repo": "https://github.com/you/api-service",
  "risk_policy": "enterprise",
  "budget_cap_usdc": 0.25,
  "notify": { "type": "slack", "webhook": "…" }
}`;

const DECISION_JSON = `{
  "schema": "quorum.decision.v1",
  "dependency": "node-ipc@9.2.1",
  "decision": "DO_NOT_SHIP",
  "confidence": 0.94,
  "lenses": {
    "health": { "agent": "Repo Doctor", "verdict": "healthy",   "tx": "0xd0e0…" },
    "trust":  { "agent": "VERIS",       "verdict": "high_risk", "tx": "0x600e…" }
  },
  "escalation": { "triggered": true, "cost_usdc": 0.03 },
  "disagreement": "Active, well-tested repo — that independent
                   due diligence says you should not trust.",
  "total_spend_usdc": 0.14,
  "receipts": ["0xd0e0…", "0x600e…", "0x…"]
}`;

export default function LandingPage() {
  return (
    <div className="flex-1 overflow-x-clip">
      <SmoothScroll />
      <Nav />
      <Hero />
      <StatBand />
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <Pillars />
        <Moment />
        <HowItWorks />
        <UseIt />
        <Comparison />
        <WhyAgentEconomy />
      </main>
      <CtaBand />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <div className="sticky top-4 z-50 mx-auto w-full max-w-5xl px-4 sm:px-6">
      <nav
        className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm backdrop-blur"
        style={{ borderColor: "var(--border-hairline)", backgroundColor: "color-mix(in srgb, var(--surface) 92%, transparent)" }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static local SVG; next/image adds no value here */}
          <img src="/logo.svg" alt="" width={34} height={34} className="rounded-xl" />
          <span className="font-display text-lg font-bold tracking-tight" style={{ color: "var(--foreground)" }}>
            Quorum
          </span>
        </Link>
        <div className="hidden items-center gap-6 text-sm font-medium sm:flex" style={{ color: "var(--text-secondary)" }}>
          <a href="#how" className="hover:opacity-70">How it works</a>
          <a href="#use" className="hover:opacity-70">Use it</a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="hover:opacity-70">GitHub</a>
        </div>
        <Link
          href="/dashboard"
          className="rounded-xl px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-85"
          style={{ backgroundColor: "var(--navy)", color: "#fffdf8" }}
        >
          Live dashboard
        </Link>
      </nav>
    </div>
  );
}

/** Small floating artifact card for the hero corners — real product output, not abstract decoration. Bobs slowly (Drift) with a per-card phase offset so they don't move in lockstep. */
function FloatCard({ className, drift = 0, children }: { className: string; drift?: number; children: React.ReactNode }) {
  return (
    <div aria-hidden className={`pointer-events-none absolute hidden lg:block ${className}`}>
      <Drift delay={drift}>
        <div
          className="rounded-2xl border px-4 py-3 shadow-lg"
          style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}
        >
          {children}
        </div>
      </Drift>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-24">
      <FloatCard drift={0} className="left-2 top-10 -rotate-6 xl:left-8">
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--status-good)" }}>
          <span aria-hidden>✓</span> SHIP
        </span>
        <span className="mt-0.5 block text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>confidence 95%</span>
      </FloatCard>
      <FloatCard drift={1.4} className="right-2 top-14 rotate-6 xl:right-8">
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--status-critical)" }}>
          <span aria-hidden>✕</span> DO NOT SHIP
        </span>
        <span className="mt-0.5 block text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>confidence 94%</span>
      </FloatCard>
      <FloatCard drift={2.8} className="bottom-16 left-6 rotate-3 xl:left-16">
        <span className="font-mono text-xs" style={{ color: "var(--accent-blue)" }}>tx 0x5968…b2b ↗</span>
        <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>settled on Base</span>
      </FloatCard>
      <FloatCard drift={4.2} className="bottom-10 right-6 -rotate-3 xl:right-16">
        <span className="text-sm font-semibold" style={{ color: "var(--green-ink)" }}>Tiebreaker bought</span>
        <span className="mt-0.5 block text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>$0.03 · disagreement resolved</span>
      </FloatCard>

      <Reveal>
        <span
          className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em]"
          style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)", color: "var(--text-secondary)" }}
        >
          <span aria-hidden style={{ color: "var(--green-ink)" }}>›</span>
          Autonomous trust broker
          <span aria-hidden style={{ color: "var(--green-ink)" }}>‹</span>
        </span>
      </Reveal>

      <Reveal delay={0.08}>
        <h1 className="font-display mx-auto mt-6 max-w-3xl text-5xl font-bold leading-[1.02] tracking-tight sm:text-7xl">
          <span style={{ color: "var(--foreground)" }}>Ship or don&apos;t ship.</span>
          <br />
          <span style={{ color: "var(--green-ink)" }}>Decided, with receipts.</span>
        </h1>
      </Reveal>

      <Reveal delay={0.16}>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed sm:text-lg" style={{ color: "var(--text-secondary)" }}>
          Quorum watches your dependencies for malicious releases, CVEs and maintainer takeovers — then hires
          independent specialist agents to verify what&apos;s real, and buys a tiebreaker only when they disagree.
          A decision and on-chain proof. Not another report.
        </p>
      </Reveal>

      <Reveal delay={0.24}>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-xl px-6 py-3 text-sm font-bold transition-opacity hover:opacity-85"
            style={{ backgroundColor: "var(--green)", color: "var(--navy)" }}
          >
            Open the live dashboard
          </Link>
          <a
            href={STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl px-6 py-3 text-sm font-bold transition-opacity hover:opacity-85"
            style={{ backgroundColor: "var(--navy)", color: "#fffdf8" }}
          >
            Hire it on the Agent Store
          </a>
        </div>
        <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
          $1.00 per registration · pay-per-event after · settled in USDC on Base
        </p>
      </Reveal>
    </section>
  );
}

function StatBand() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 sm:px-6">
      <Reveal delay={0.3}>
        <div
          className="grid grid-cols-2 divide-y rounded-2xl border sm:grid-cols-4 sm:divide-x sm:divide-y-0"
          style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}
        >
          {STATS.map((stat) => (
            <div key={stat.label} className="px-5 py-5 text-center" style={{ borderColor: "var(--gridline)" }}>
              <div className="font-display text-3xl font-bold tabular-nums" style={{ color: "var(--foreground)" }}>
                {stat.value}
              </div>
              <div className="mt-1 text-xs leading-snug" style={{ color: "var(--text-muted)" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function SectionHeading({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--green-ink)" }}>
        {eyebrow}
      </p>
      <h2 className="font-display mt-2 text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: "var(--foreground)" }}>
        {title}
      </h2>
      {lede && (
        <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {lede}
        </p>
      )}
    </div>
  );
}

function Pillars() {
  return (
    <section className="mt-24">
      <Reveal>
        <SectionHeading eyebrow="What it does" title="Three jobs. One verdict." />
      </Reveal>
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {PILLARS.map((pillar, i) => (
          <Reveal key={pillar.title} delay={i * 0.1}>
            <div
              className="h-full rounded-2xl border p-6"
              style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}
            >
              <span className="font-mono text-xs font-semibold" style={{ color: "var(--green-ink)" }}>
                *{String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display mt-2 text-xl font-bold" style={{ color: "var(--foreground)" }}>
                {pillar.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {pillar.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/**
 * The real 2026-07-03 mainnet run, from SDK_NOTES.md item 26 — receipts and
 * all. Row colors are hardcoded light-on-navy values (not the theme's status
 * tokens, which are tuned for the cream surface and lose contrast here).
 */
function Moment() {
  const rows = [
    { time: "17:06", color: "rgba(255,253,248,0.75)", text: "new_cve CVE-2022-23812 · node-ipc — Risk Gate: critical advisory on a production dependency → investigate" },
    { time: "17:07", color: "#34d399", text: "Repo Doctor hired → HEALTHY · $0.01 · tx 0xd0e04941…f41f" },
    { time: "17:09", color: "#f87171", text: "VERIS hired → LEGITIMACY 34/100 · HIGH RISK · $0.10 · tx 0x600e5f58…c55" },
    { time: "17:09", color: "#b8aff5", bold: true, text: "⚡ DISAGREEMENT — a healthy repo you shouldn't trust. Confidence 0.60 < enterprise target 0.90" },
    { time: "17:09", color: "rgba(255,253,248,0.75)", text: "Escalation fires: Quorum moves to buy a ~$0.03 fact-check tiebreak… and the counterparty's chain step fails mid-order" },
    { time: "17:10", color: "#fffdf8", bold: true, text: "Verdict: REVIEW @ 0.60 — reported honestly. No fabricated confidence, $0 paid for the failure. Total spend $0.11, two receipts." },
  ];
  return (
    <section className="mt-24">
      <Reveal>
        <SectionHeading
          eyebrow="The moment that matters"
          title="Two experts disagreed. Quorum reached for its wallet."
          lede="This isn't a mockup — it's a real investigation on Base mainnet, receipts included. And when the tiebreaker's own infrastructure failed mid-order, Quorum told the truth instead of inventing a number."
        />
      </Reveal>
      <Reveal delay={0.1}>
        <div
          className="mt-8 overflow-x-auto rounded-2xl border p-5 sm:p-6"
          style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--navy)" }}
        >
          <div className="min-w-[540px] space-y-3 font-mono text-[13px] leading-relaxed">
            {rows.map((row, i) => (
              // Rows replay like a log tailing in: each fades up on its own beat.
              <Reveal key={i} delay={0.2 + i * 0.12}>
                <div className="flex gap-4">
                  <span className="shrink-0 tabular-nums" style={{ color: "rgba(255,253,248,0.4)" }}>
                    {row.time}
                  </span>
                  <span className={row.bold ? "font-bold" : ""} style={{ color: row.color }}>
                    {row.text}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="mt-24 scroll-mt-24">
      <Reveal>
        <SectionHeading eyebrow="How it works" title="From advisory to answer in six moves." />
      </Reveal>
      <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="h-full">
            <Reveal delay={(i % 3) * 0.08} className="h-full">
              <div
                className="h-full rounded-2xl border p-5"
                style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}
              >
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full font-mono text-xs font-bold"
                  style={{ backgroundColor: "var(--green)", color: "var(--navy)" }}
                >
                  {i + 1}
                </span>
                <h3 className="mt-3 text-sm font-bold" style={{ color: "var(--foreground)" }}>
                  {step.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {step.body}
                </p>
              </div>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CodeCard({ label, code, delay = 0 }: { label: string; code: string; delay?: number }) {
  return (
    <Reveal delay={delay} className="min-w-0 flex-1">
      <p className="text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <pre
        className="mt-2 overflow-x-auto rounded-2xl border p-4 font-mono text-xs leading-relaxed"
        style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)", color: "var(--text-secondary)" }}
      >
        {code}
      </pre>
    </Reveal>
  );
}

function UseIt() {
  return (
    <section id="use" className="mt-24 scroll-mt-24">
      <Reveal>
        <SectionHeading
          eyebrow="Use it"
          title="One registration. Decisions forever."
          lede="Quorum is a callable CAP agent — order “Supply Chain Trust Monitor” on the CROO Agent Store from your own agent or the store UI. Send a repo and a risk policy; every future trust event comes back as a structured, signed-and-settled decision."
        />
      </Reveal>
      <div className="mt-8 flex flex-col gap-4 lg:flex-row">
        <CodeCard label="You send" code={REQUEST_JSON} />
        <div className="hidden items-center font-display text-2xl font-bold lg:flex" style={{ color: "var(--green-ink)" }} aria-hidden>
          →
        </div>
        <CodeCard label="You get back — quorum.decision.v1" code={DECISION_JSON} delay={0.12} />
      </div>

      <Reveal>
      <div className="mt-8 overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--border-hairline)" }}>
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--surface)" }}>
              <th className="p-3 text-left font-semibold" style={{ color: "var(--text-muted)" }}>Risk policy</th>
              <th className="p-3 text-left font-semibold" style={{ color: "var(--text-muted)" }}>Confidence target</th>
              <th className="p-3 text-left font-semibold" style={{ color: "var(--text-muted)" }}>Budget cap / event</th>
              <th className="p-3 text-left font-semibold" style={{ color: "var(--text-muted)" }}>Posture</th>
            </tr>
          </thead>
          <tbody>
            {POLICIES.map((policy) => (
              <tr key={policy.name} className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
                <td className="p-3 font-mono font-semibold" style={{ color: "var(--green-ink)" }}>{policy.name}</td>
                <td className="p-3 tabular-nums" style={{ color: "var(--foreground)" }}>{policy.target}</td>
                <td className="p-3 tabular-nums" style={{ color: "var(--foreground)" }}>{policy.cap}</td>
                <td className="p-3" style={{ color: "var(--text-secondary)" }}>{policy.posture}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
        The policy chooses how much certainty to buy — you never micromanage a call.
      </p>
      </Reveal>
    </section>
  );
}

function Comparison() {
  return (
    <section className="mt-24">
      <Reveal>
        <SectionHeading
          eyebrow="Not another scanner"
          title="Scanners hand you a report. Quorum hands you an answer."
          lede="Repo Doctor already sells a health check; VERIS already sells due diligence. Quorum hires both, reconciles engineering health against supply-chain trust, and puts money behind resolving the conflict."
        />
      </Reveal>
      <Reveal delay={0.1}>
      <div className="mt-8 overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--border-hairline)" }}>
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--surface)" }}>
              <th className="p-3 text-left font-medium" style={{ color: "var(--text-muted)" }} />
              <th className="p-3 text-left font-bold" style={{ color: "var(--green-ink)" }}>Quorum</th>
              <th className="p-3 text-left font-semibold" style={{ color: "var(--text-secondary)" }}>Repo Doctor</th>
              <th className="p-3 text-left font-semibold" style={{ color: "var(--text-secondary)" }}>VERIS</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.row} className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
                <td className="p-3 font-medium" style={{ color: "var(--text-muted)" }}>{row.row}</td>
                <td className="p-3 font-semibold" style={{ color: "var(--foreground)" }}>{row.quorum}</td>
                <td className="p-3" style={{ color: "var(--text-secondary)" }}>{row.repoDoctor}</td>
                <td className="p-3" style={{ color: "var(--text-secondary)" }}>{row.veris}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </Reveal>
    </section>
  );
}

function WhyAgentEconomy() {
  return (
    <section className="mt-24">
      <Reveal>
      <div
        className="rounded-2xl border p-6 sm:p-10"
        style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--green-ink)" }}>
          Why this needs an agent economy
        </p>
        <p className="font-display mt-3 max-w-3xl text-xl font-bold leading-snug sm:text-2xl" style={{ color: "var(--foreground)" }}>
          “Buy another opinion for $0.03, because confidence is below the enterprise threshold” is a sentence no
          API marketplace can execute.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed sm:text-base" style={{ color: "var(--text-secondary)" }}>
          Quorum hires independent specialist agents it doesn&apos;t own, over a permissionless protocol, with
          escrow and verifiable on-chain receipts — and decides on its own when spending money to reduce its own
          uncertainty is justified. That decision loop is the product, and it only exists where agents can pay
          each other.
        </p>
      </div>
      </Reveal>
    </section>
  );
}

function CtaBand() {
  return (
    <section className="mx-auto mt-24 w-full max-w-5xl px-4 sm:px-6">
      <Reveal>
      <div className="rounded-3xl px-6 py-12 text-center sm:px-12 sm:py-16" style={{ backgroundColor: "var(--navy)" }}>
        <h2 className="font-display mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl" style={{ color: "#fffdf8" }}>
          Your dependencies won&apos;t wait.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed sm:text-base" style={{ color: "rgba(255,253,248,0.7)" }}>
          Register a repo once. Pay nothing while nothing happens. Get a defendable decision — with receipts —
          the moment something does.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href={STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl px-6 py-3 text-sm font-bold transition-opacity hover:opacity-85"
            style={{ backgroundColor: "var(--green)", color: "var(--navy)" }}
          >
            Hire Quorum on the Agent Store
          </a>
          <Link
            href="/dashboard"
            className="rounded-xl border px-6 py-3 text-sm font-bold transition-opacity hover:opacity-85"
            style={{ borderColor: "rgba(255,253,248,0.25)", color: "#fffdf8" }}
          >
            Watch it live
          </Link>
        </div>
      </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto mt-16 w-full max-w-5xl px-4 pb-10 sm:px-6">
      <div className="grid grid-cols-1 gap-8 border-t pt-10 sm:grid-cols-4" style={{ borderColor: "var(--border-hairline)" }}>
        <div className="sm:col-span-2">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static local SVG */}
            <img src="/logo.svg" alt="" width={30} height={30} className="rounded-lg" />
            <span className="font-display text-base font-bold" style={{ color: "var(--foreground)" }}>Quorum</span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            An autonomous trust broker for your software supply chain. It detects trust events, hires independent
            experts, reconciles their disagreement, and returns a ship/don&apos;t-ship decision with on-chain proof.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--text-muted)" }}>Product</p>
          <ul className="mt-3 space-y-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <li><Link href="/dashboard" className="hover:opacity-70">Live dashboard</Link></li>
            <li><a href={STORE_URL} target="_blank" rel="noopener noreferrer" className="hover:opacity-70">Agent Store listing</a></li>
            <li><a href={`${GITHUB_URL}/blob/main/schemas/quorum.decision.schema.json`} target="_blank" rel="noopener noreferrer" className="hover:opacity-70">Decision schema</a></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--text-muted)" }}>Network</p>
          <ul className="mt-3 space-y-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <li><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="hover:opacity-70">GitHub (MIT)</a></li>
            <li><a href="https://agent.croo.network" target="_blank" rel="noopener noreferrer" className="hover:opacity-70">CROO Agent Store</a></li>
            <li><a href="https://basescan.org" target="_blank" rel="noopener noreferrer" className="hover:opacity-70">Basescan</a></li>
          </ul>
        </div>
      </div>
      <p className="mt-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
        © 2026 Quorum · Built on the CROO Agent Protocol · USDC settlement on Base mainnet
      </p>
    </footer>
  );
}
