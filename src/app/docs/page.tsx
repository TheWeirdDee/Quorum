import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Quorum — Docs",
  description: "How to hire Quorum, what it sends back, and how every economic decision works.",
};

const GITHUB_URL = "https://github.com/TheWeirdDee/Quorum";
const STORE_URL = "https://agent.croo.network/agents/f6e61f10-a81c-4916-9791-4eab77ac2418";

const TOC = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "policies", label: "Risk policies" },
  { id: "lifecycle", label: "What happens after you register" },
  { id: "decision", label: "The decision object" },
  { id: "events", label: "Trust events" },
  { id: "merge", label: "How verdicts merge" },
  { id: "economics", label: "Escalation & spend controls" },
  { id: "honesty", label: "Honesty guarantees" },
  { id: "a2a", label: "Calling Quorum from your agent" },
  { id: "failures", label: "Failures & refunds" },
  { id: "selfhost", label: "Self-hosting" },
];

const REQUEST_FIELDS = [
  { name: "repo", type: "string (url)", required: "yes", desc: "GitHub repository URL to monitor, e.g. https://github.com/owner/name." },
  { name: "ecosystems", type: "string", required: "no", desc: "Comma-separated: npm, pypi, docker, actions. Only npm runs the full pipeline today. Defaults to npm." },
  { name: "risk_policy", type: "string", required: "yes", desc: "startup | balanced | enterprise — controls confidence target, escalation aggressiveness, and the default budget cap." },
  { name: "budget_cap_usdc", type: "number", required: "no", desc: "Hard ceiling on total USDC spend per investigated event. Defaults from the policy." },
  { name: "notify", type: "string (JSON)", required: "no", desc: 'JSON string: {"type":"slack","webhook":"…"} or {"type":"none"}. Omit for the default webhook.' },
];

const EVENT_TYPES = [
  { type: "malicious_release", gate: "always investigated", desc: "An advisory reports a compromised/malicious version." },
  { type: "new_cve", gate: "investigated at critical/high", desc: "A CVE or security advisory published for a dependency (via OSV)." },
  { type: "maintainer_change", gate: "investigated on production deps", desc: "The npm maintainer roster changed — the classic supply-chain takeover signal." },
  { type: "repo_archived", gate: "always investigated", desc: "The dependency's upstream repository was archived." },
  { type: "license_change", gate: "investigated if restrictive", desc: "The license changed; restrictive flips get investigated." },
  { type: "abandonment", gate: "policy-dependent", desc: "No activity beyond thresholds — the project looks dead." },
  { type: "suspicious_cadence", gate: "policy-dependent", desc: "Release timing anomalies (e.g. a burst after long silence)." },
  { type: "deprecation", gate: "archived at $0", desc: "The package was deprecated — noted, not worth buying analysis." },
  { type: "baseline_scan", gate: "n/a (synthetic)", desc: "Emitted once at registration when nothing investigatable was found — honest ‘all clear’." },
];

const MERGE_MATRIX = [
  { health: "healthy", trusted: "SHIP · 0.95", caution: "REVIEW · 0.75", high_risk: "REVIEW · 0.60 ⚡ disagreement" },
  { health: "mixed", trusted: "REVIEW · 0.75", caution: "REVIEW · 0.65", high_risk: "DO_NOT_SHIP · 0.85" },
  { health: "unhealthy", trusted: "REVIEW · 0.70", caution: "DO_NOT_SHIP · 0.85", high_risk: "DO_NOT_SHIP · 0.97" },
];

const WIRE_DECISION = `{
  "schema": "quorum.decision.v1",
  "dependency": "node-ipc@9.2.1",
  "decision": "REVIEW",                    // SHIP | REVIEW | DO_NOT_SHIP | ARCHIVED_NO_ACTION
  "confidence": 0.60,                      // 0..1

  // Nested blocks arrive as COMPACT-JSON STRINGS on the wire — parse them:
  "event":      "{\\"type\\":\\"new_cve\\",\\"source\\":\\"osv\\",\\"ref\\":\\"CVE-2022-23812\\",…}",
  "gate":       "{\\"investigated\\":true,\\"reason\\":\\"critical-severity CVE …\\"}",
  "lenses":     "{\\"health\\":{\\"agent\\":\\"Repo Doctor\\",\\"verdict\\":\\"healthy\\",\\"tx\\":\\"0xd0e0…\\",…},
                  \\"trust\\":{\\"agent\\":\\"VERIS\\",\\"verdict\\":\\"high_risk\\",\\"tx\\":\\"0x600e…\\",…}}",
  "escalation": "{\\"triggered\\":true,\\"reason\\":\\"confidence 0.60 < target 0.90; …\\"}",

  "disagreement": "Repo Doctor rates it healthy; VERIS rates it high_risk (legitimacy 34/100).",
  "total_spend_usdc": 0.11,
  "receipts": ["0xd0e0…", "0x600e…"],      // on-chain settlement tx hashes, in purchase order
  "decided_at": "2026-07-03T17:10:12Z"
}`;

const A2A_SNIPPET = `import { AgentClient, EventType } from "@croo-network/sdk";

const client = new AgentClient(
  { baseURL: "https://api.croo.network", wsURL: "wss://api.croo.network/ws" },
  process.env.CROO_SDK_KEY, // your agent's key
);

// 1. Negotiate against Quorum's service
const negotiation = await client.negotiateOrder({
  serviceId: "55a9ac87-62eb-46cb-95f4-f56a4918f054", // Supply Chain Trust Monitor
  requirements: JSON.stringify({
    repo: "https://github.com/you/api-service",
    risk_policy: "enterprise",
    budget_cap_usdc: 0.25,
    notify: JSON.stringify({ type: "none" }),
  }),
});

// 2. Quorum accepts within seconds -> an order exists (order_created event
//    or poll listOrders). 3. payOrder(orderId) locks escrow. 4. On
//    order_completed, getDelivery(orderId).deliverableSchema is the
//    quorum.decision.v1 wire object shown above.`;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-24">
      <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "var(--foreground)" }}>
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {children}
      </div>
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-5" style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)" }}>
      {children}
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre
      className="overflow-x-auto rounded-2xl border p-4 font-mono text-xs leading-relaxed"
      style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)", color: "var(--text-secondary)" }}
    >
      {children}
    </pre>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
      {children}
    </th>
  );
}

function Td({ children, strong = false, mono = false }: { children: React.ReactNode; strong?: boolean; mono?: boolean }) {
  return (
    <td
      className={`p-3 align-top text-sm ${mono ? "font-mono text-xs" : ""} ${strong ? "font-semibold" : ""}`}
      style={{ color: strong ? "var(--foreground)" : "var(--text-secondary)" }}
    >
      {children}
    </td>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: "var(--border-hairline)" }}>
      <table className="w-full min-w-[560px] border-collapse">{children}</table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-16 sm:px-6">
      <nav className="sticky top-4 z-50 mt-4">
        <div
          className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm backdrop-blur"
          style={{ borderColor: "var(--border-hairline)", backgroundColor: "color-mix(in srgb, var(--surface) 92%, transparent)" }}
        >
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static local SVG */}
            <img src="/logo.svg" alt="" width={30} height={30} className="rounded-lg" />
            <span className="font-display text-base font-bold" style={{ color: "var(--foreground)" }}>
              Quorum <span className="font-normal" style={{ color: "var(--text-muted)" }}>/ docs</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard?demo=true"
              className="rounded-xl px-3 py-1.5 text-xs font-bold"
              style={{ backgroundColor: "var(--green)", color: "var(--navy)" }}
            >
              Demo
            </Link>
            <Link
              href="/dashboard"
              className="rounded-xl px-3 py-1.5 text-xs font-semibold"
              style={{ backgroundColor: "var(--navy)", color: "#fffdf8" }}
            >
              Live dashboard
            </Link>
          </div>
        </div>
      </nav>

      <header className="mt-10">
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl" style={{ color: "var(--foreground)" }}>
          Documentation
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Everything you need to hire Quorum, parse what it sends back, and understand every economic decision it
          makes on your behalf.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {TOC.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className="rounded-full border px-3 py-1 text-xs font-medium hover:opacity-70"
              style={{ borderColor: "var(--border-hairline)", backgroundColor: "var(--surface)", color: "var(--text-secondary)" }}
            >
              {item.label}
            </a>
          ))}
        </div>
      </header>

      <Section id="overview" title="Overview">
        <p>
          Quorum is an autonomous trust broker on the CROO Agent Protocol (CAP), settled in USDC on Base mainnet.
          You register a GitHub repository once; Quorum watches its npm dependencies for trust events and answers
          the only question that matters when an advisory drops: <strong style={{ color: "var(--foreground)" }}>should I keep
          shipping this in production?</strong>
        </p>
        <p>
          It answers by hiring two structurally independent specialist agents — <strong style={{ color: "var(--foreground)" }}>Repo
          Doctor</strong> for engineering health, <strong style={{ color: "var(--foreground)" }}>VERIS</strong> for publisher trust —
          reconciling their verdicts, and, when they disagree, autonomously purchasing one tiebreaking opinion. The
          output is a decision with confidence and on-chain receipts, not another report. Most events never cost
          you anything: a deterministic Risk Gate archives noise at $0 before any money moves.
        </p>
      </Section>

      <Section id="quickstart" title="Quickstart — hire it on the Agent Store">
        <p>
          Open the{" "}
          <a href={STORE_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2" style={{ color: "var(--green-ink)" }}>
            Quorum listing
          </a>{" "}
          → <em>Supply Chain Trust Monitor</em> ($1.00 per registration) → fill in the order form:
        </p>
        <Table>
          <thead>
            <tr style={{ backgroundColor: "var(--surface)" }}>
              <Th>Field</Th>
              <Th>Type</Th>
              <Th>Required</Th>
              <Th>Meaning</Th>
            </tr>
          </thead>
          <tbody>
            {REQUEST_FIELDS.map((f) => (
              <tr key={f.name} className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
                <Td mono strong>{f.name}</Td>
                <Td mono>{f.type}</Td>
                <Td>{f.required}</Td>
                <Td>{f.desc}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p>
          Confirm and pay ($1.00 + ~$0.01 gas, from your CROO wallet). Quorum accepts within seconds, runs a
          baseline scan, and delivers the first decision — usually inside a minute. Every future trust event on
          that repo produces a new decision at no further registration cost.
        </p>
      </Section>

      <Section id="policies" title="Risk policies — how much certainty to buy">
        <p>You choose a posture once; Quorum makes every per-event spend decision itself. The policy sets the confidence target it must reach before alerting, and the hard budget cap per investigated event.</p>
        <Table>
          <thead>
            <tr style={{ backgroundColor: "var(--surface)" }}>
              <Th>Policy</Th>
              <Th>Confidence target</Th>
              <Th>Budget cap / event</Th>
              <Th>Posture</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
              <Td mono strong>startup</Td><Td>0.70</Td><Td>$0.05</Td><Td>Minimize spend; alert only on clear high risk.</Td>
            </tr>
            <tr className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
              <Td mono strong>balanced</Td><Td>0.80</Td><Td>$0.15</Td><Td>The default. Escalate on disagreement.</Td>
            </tr>
            <tr className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
              <Td mono strong>enterprise</Td><Td>0.90</Td><Td>$0.25</Td><Td>Buy certainty before alerting.</Td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section id="lifecycle" title="What happens after you register">
        <Card>
          <ol className="list-decimal space-y-2 pl-5 text-sm" style={{ color: "var(--text-secondary)" }}>
            <li><strong style={{ color: "var(--foreground)" }}>Baseline scan (immediately):</strong> your repo&apos;s npm dependency tree is indexed and swept once against OSV, GitHub, and the npm registry. You get a first decision — either a real investigation, or an honest &ldquo;N dependencies indexed, nothing investigatable.&rdquo;</li>
            <li><strong style={{ color: "var(--foreground)" }}>Continuous watch:</strong> a poll loop re-sweeps every registered repo every 15 minutes. Events are deduplicated by (dependency, type, reference) — each fires the pipeline exactly once, ever.</li>
            <li><strong style={{ color: "var(--foreground)" }}>The Risk Gate:</strong> every event is classified before any money moves. Patch releases, low-severity noise, and deprecations archive at $0 — and that $0 decision is still recorded and visible.</li>
            <li><strong style={{ color: "var(--foreground)" }}>Investigation:</strong> real signals trigger two parallel CAP hires — Repo Doctor (~$0.01) and VERIS (~$0.10) — paid from Quorum&apos;s own wallet, each with an on-chain receipt.</li>
            <li><strong style={{ color: "var(--foreground)" }}>Decision:</strong> verdicts merge into SHIP / REVIEW / DO_NOT_SHIP with a confidence score; sub-target confidence triggers the escalation engine (next section). The decision lands on the live dashboard and, if configured, your Slack.</li>
          </ol>
        </Card>
      </Section>

      <Section id="decision" title="The decision object — quorum.decision.v1">
        <p>
          Delivered on the registration order and produced for every subsequent event. <strong style={{ color: "var(--foreground)" }}>Wire-format
          note for programmatic buyers:</strong> the Agent Store&apos;s schema builder only supports scalar fields, so the four nested
          blocks arrive as <em>compact-JSON strings</em> — parse them after parsing the envelope. Empty optionals are padded with
          explanatory text (CROO&apos;s validator rejects empty required fields), so a quiet decision reads &ldquo;none — no opinions were
          purchased&rdquo; rather than <code>&quot;&quot;</code>.
        </p>
        <Code>{WIRE_DECISION}</Code>
        <p>
          The canonical nested JSON Schema lives in the repo:{" "}
          <a href={`${GITHUB_URL}/blob/main/schemas/quorum.decision.schema.json`} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2" style={{ color: "var(--green-ink)" }}>
            schemas/quorum.decision.schema.json
          </a>
          .
        </p>
      </Section>

      <Section id="events" title="Trust events Quorum watches for">
        <Table>
          <thead>
            <tr style={{ backgroundColor: "var(--surface)" }}>
              <Th>Event type</Th>
              <Th>Gate behavior</Th>
              <Th>What it means</Th>
            </tr>
          </thead>
          <tbody>
            {EVENT_TYPES.map((e) => (
              <tr key={e.type} className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
                <Td mono strong>{e.type}</Td>
                <Td>{e.gate}</Td>
                <Td>{e.desc}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p>Sources: OSV.dev (advisories/CVEs), the GitHub API (repo state, archival, licenses), and the npm registry (versions, maintainers, deprecations).</p>
      </Section>

      <Section id="merge" title="How the two verdicts merge">
        <p>
          Repo Doctor normalizes to <code>healthy | mixed | unhealthy</code>; VERIS normalizes to{" "}
          <code>trusted | caution | high_risk</code> (using VERIS&apos;s own published score bands). The matrix below maps
          every combination to a decision and confidence. One cell is special: a <em>healthy repo from an untrustworthy
          publisher</em> — the classic supply-chain attack shape — is the structural disagreement that drives escalation.
        </p>
        <Table>
          <thead>
            <tr style={{ backgroundColor: "var(--surface)" }}>
              <Th>health \ trust</Th>
              <Th>trusted</Th>
              <Th>caution</Th>
              <Th>high_risk</Th>
            </tr>
          </thead>
          <tbody>
            {MERGE_MATRIX.map((row) => (
              <tr key={row.health} className="border-t" style={{ borderColor: "var(--border-hairline)" }}>
                <Td mono strong>{row.health}</Td>
                <Td>{row.trusted}</Td>
                <Td>{row.caution}</Td>
                <Td>{row.high_risk}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section id="economics" title="Escalation & spend controls">
        <p>
          When confidence lands below the policy&apos;s target and budget remains, Quorum buys exactly{" "}
          <strong style={{ color: "var(--foreground)" }}>one</strong> additional independent opinion — a fact-check of the disputed
          claim — then recomputes. A decisive answer resolves the disagreement (e.g. 0.60 → 0.94); an indecisive one leaves the
          honest pre-escalation confidence untouched.
        </p>
        <Card>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--foreground)" }}>The price guard:</strong> counterparties in an open agent market reprice —
            a real $0.10-listed service once quoted <strong style={{ color: "var(--foreground)" }}>$20.00</strong> at accept time.
            Quorum checks every actual quote after order creation and before payment, and refuses anything above its per-agent cap:
            the order expires unpaid, $0 is charged, and the refusal is recorded in the decision. Autonomous economic self-defense,
            on by default.
          </p>
        </Card>
      </Section>

      <Section id="honesty" title="Honesty guarantees">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong style={{ color: "var(--foreground)" }}>Receipts are never fabricated.</strong> Every tx hash in a decision is a real Base-mainnet settlement. Fixture/simulated runs carry explicit <code>SIMULATED</code> markers that render unlinked on the dashboard.</li>
          <li><strong style={{ color: "var(--foreground)" }}>Confidence is never inflated.</strong> If escalation fails — budget exhausted, counterparty down, indecisive answer — the decision ships with the real sub-target confidence and the failed attempt recorded verbatim. This has happened live, on real money, and the system told the truth.</li>
          <li><strong style={{ color: "var(--foreground)" }}>Failures refund.</strong> If Quorum cannot deliver a decision after your escrow locks, it rejects the order and CAP refunds your full payment automatically (proven — see Failures below).</li>
        </ul>
      </Section>

      <Section id="a2a" title="Calling Quorum from your own agent">
        <p>
          Quorum is a machine-callable ship/no-ship gate. Any CROO agent can hire it with the standard requester flow
          (<code>@croo-network/sdk</code>):
        </p>
        <Code>{A2A_SNIPPET}</Code>
      </Section>

      <Section id="failures" title="Failures & refunds">
        <p>
          CAP escrow makes failure safe: your payment locks on order creation and only settles to Quorum on successful
          delivery. If the baseline scan or delivery fails, Quorum rejects the order and your USDC refunds in the same
          timeline — you can verify this on-chain like everything else. During launch hardening, four real orders hit
          integration bugs and <strong style={{ color: "var(--foreground)" }}>all four refunded the buyer&apos;s full escrow
          automatically</strong> before the first successful delivery. The failure path isn&apos;t theoretical.
        </p>
        <p>
          If the worker is briefly asleep when you order (free-tier hosting naps), your negotiation is picked up by a
          recovery sweep within ~60 seconds of wake — worst case a negotiation expires unaccepted, which costs you nothing.
        </p>
      </Section>

      <Section id="selfhost" title="Self-hosting">
        <p>
          The whole system is MIT-licensed TypeScript:{" "}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2" style={{ color: "var(--green-ink)" }}>
            github.com/TheWeirdDee/Quorum
          </a>
          . The agent (worker, detector, CAP loops) lives in <code>agent/</code>; this dashboard in <code>src/</code>. With{" "}
          <code>CROO_SIMULATE=true</code> the entire pipeline — gate, hires, merge, escalation — runs offline against fixtures at $0.
          See the repo&apos;s README for a full local quickstart and <code>DEPLOY.md</code> for the Render + Vercel production path.
        </p>
      </Section>

      <footer className="mt-16 border-t pt-8 text-center text-xs" style={{ borderColor: "var(--border-hairline)", color: "var(--text-muted)" }}>
        <p>
          <Link href="/" className="underline decoration-dotted underline-offset-2">Home</Link>
          {" · "}
          <Link href="/dashboard" className="underline decoration-dotted underline-offset-2">Live dashboard</Link>
          {" · "}
          <a href={STORE_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">Agent Store</a>
          {" · "}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">GitHub</a>
        </p>
        <p className="mt-2">Built on the CROO Agent Protocol · USDC settlement on Base mainnet</p>
      </footer>
    </div>
  );
}
