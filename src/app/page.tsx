import Link from "next/link";
import { DecisionBadge } from "../components/DecisionBadge";

const STEPS = [
  { title: "Register a repo, once", body: "Point Quorum at a GitHub repo and a risk policy (startup / balanced / enterprise). It indexes the npm dependency tree and starts watching." },
  { title: "Watch for trust events", body: "Malicious releases, new CVEs, maintainer changes, abandonment, license flips — polled from OSV, GitHub, and the npm registry, deduped so each event fires once." },
  { title: "Decide if it's worth paying for", body: "The Risk Gate classifies every event before any money moves. Most archive at $0. Only real signals — critical CVEs, malicious releases, ownership changes — get investigated." },
  { title: "Hire two independent lenses", body: "Repo Doctor answers “is this technically healthy?” VERIS answers “is this trustworthy?” Both hired live over CAP, in USDC, with on-chain receipts." },
  { title: "Buy a tiebreaker, only on disagreement", body: "When the two lenses conflict — or confidence lands below the policy's target — Quorum autonomously purchases one more opinion to resolve it. Bounded by a budget cap." },
  { title: "Ship a decision, not a report", body: "SHIP, REVIEW, or DO_NOT_SHIP, with a confidence score, the disagreement made explicit, and every receipt attached." },
];

const COMPARISON = [
  { row: "Answers", repoDoctor: "Is this repo technically healthy?", veris: "Is this project/publisher trustworthy?", quorum: "Should I keep shipping this in production?" },
  { row: "Output", repoDoctor: "Report", veris: "Report", quorum: "Decision + confidence + receipts" },
  { row: "Trigger", repoDoctor: "On demand", veris: "On demand", quorum: "Autonomous, event-driven" },
  { row: "Spends money", repoDoctor: "No", veris: "No", quorum: "Yes — only when justified" },
];

export default function LandingPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-6">
      <Nav />
      <Hero />
      <HowItWorks />
      <Comparison />
      <WhyAgentEconomy />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <nav className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static local SVG; next/image adds no value here */}
        <img src="/logo.svg" alt="" width={36} height={36} className="rounded-lg" />
        <span className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
          Quorum
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <a
          href="https://github.com/TheWeirdDee/Quorum"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2"
          style={{ color: "var(--text-secondary)" }}
        >
          GitHub
        </a>
        <Link
          href="/dashboard"
          className="rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{ backgroundColor: "var(--foreground)", color: "var(--background)" }}
        >
          Live dashboard →
        </Link>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="mt-14 sm:mt-20">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--accent-blue)" }}>
        Autonomous trust broker · built on CAP
      </p>
      <h1 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl" style={{ color: "var(--foreground)" }}>
        Should I keep shipping this dependency in production?
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed sm:text-lg" style={{ color: "var(--text-secondary)" }}>
        Quorum watches your software supply chain. When a trust event fires, it hires independent specialist
        agents to assess engineering health and supply-chain trust, reconciles what they find, and — only when
        they disagree — autonomously spends a little more to buy certainty. The output is a decision, with
        confidence and on-chain receipts. Not another report.
      </p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard"
          className="rounded-full px-5 py-2.5 text-sm font-semibold"
          style={{ backgroundColor: "var(--foreground)", color: "var(--background)" }}
        >
          View live dashboard →
        </Link>
        <a
          href="https://github.com/TheWeirdDee/Quorum"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border px-5 py-2.5 text-sm font-semibold"
          style={{ borderColor: "var(--border-hairline)", color: "var(--foreground)" }}
        >
          View source
        </a>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3 rounded-lg border p-4" style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}>
        <span className="font-mono text-sm" style={{ color: "var(--text-secondary)" }}>
          left-pad@2.4.1
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          malicious_release · critical
        </span>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Repo Doctor: healthy · VERIS: high_risk
        </span>
        <DecisionBadge decision="DO_NOT_SHIP" />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          94% confidence · $0.14 spent · 3 receipts
        </span>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="mt-20">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        How it works
      </h2>
      <ol className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <li key={step.title} className="rounded-lg border p-4" style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}>
            <span className="font-mono text-xs" style={{ color: "var(--accent-blue)" }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-1 text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Comparison() {
  return (
    <section className="mt-20">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        Not another scanner
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        Repo Doctor already sells a repo health check. Quorum sits above specialists like it — the product is the
        reconciliation and the economic decision, not the underlying check.
      </p>
      {/* Quorum leads (not trails) so it's the column visible without scrolling on narrow viewports — the whole point of this table, not an afterthought off to the right. */}
      <div className="mt-5 overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border-hairline)" }}>
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr style={{ backgroundColor: "var(--surface)" }}>
              <th className="p-3 text-left font-medium" style={{ color: "var(--text-muted)" }} />
              <th className="p-3 text-left font-semibold" style={{ color: "var(--accent-blue)" }}>
                Quorum
              </th>
              <th className="p-3 text-left font-semibold" style={{ color: "var(--text-secondary)" }}>
                Repo Doctor
              </th>
              <th className="p-3 text-left font-semibold" style={{ color: "var(--text-secondary)" }}>
                VERIS
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.row} className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
                <td className="p-3 font-medium" style={{ color: "var(--text-muted)" }}>
                  {row.row}
                </td>
                <td className="p-3 font-medium" style={{ color: "var(--foreground)" }}>
                  {row.quorum}
                </td>
                <td className="p-3" style={{ color: "var(--text-secondary)" }}>
                  {row.repoDoctor}
                </td>
                <td className="p-3" style={{ color: "var(--text-secondary)" }}>
                  {row.veris}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WhyAgentEconomy() {
  return (
    <section className="mt-20 rounded-lg border p-6 sm:p-8" style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
        Why this needs an agent economy
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed sm:text-base" style={{ color: "var(--text-secondary)" }}>
        A normal API marketplace can&apos;t do the core behavior here: an autonomous agent that decides, on its own,
        to spend money to reduce its own uncertainty. Quorum hires independent specialist agents it doesn&apos;t
        own, pays them per-assessment in USDC with escrow and verifiable on-chain receipts, and makes an economic
        decision — spend or don&apos;t, and how much — governed by a risk policy. &ldquo;Buy another opinion for
        $0.03 because confidence is below the enterprise threshold&rdquo; is only possible in an agent economy.
      </p>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-20 mb-6 flex flex-col items-center gap-2 text-center text-xs" style={{ color: "var(--text-muted)" }}>
      <p>Built on the CROO Agent Protocol (CAP) · Base mainnet · USDC settlement</p>
      <a
        href="https://github.com/TheWeirdDee/Quorum"
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-dotted underline-offset-2"
      >
        github.com/TheWeirdDee/Quorum
      </a>
    </footer>
  );
}
