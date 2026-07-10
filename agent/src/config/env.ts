import "dotenv/config";
import { z } from "zod";

function boolFromString(defaultValue: "true" | "false") {
  return z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((v) => v === "true");
}

const envSchema = z.object({
  // ── CROO / CAP ──
  // The SDK is custodial (see SDK_NOTES.md item 1): auth is SDK-Key only, no
  // private key, no chain id, no token address — the backend signs and
  // funds come from depositing USDC to the agent's AA wallet via the
  // Dashboard, not from anything this process holds.
  CROO_API_URL: z.string().url().default("https://api.croo.network"),
  CROO_WS_URL: z.string().url().default("wss://api.croo.network/ws"),
  CROO_API_KEY: z.string().default(""),
  CROO_AGENT_ID: z.string().default(""),
  CROO_RPC_URL: z.string().default(""),
  /** Defaults to simulate: real mainnet spend only when CROO_SIMULATE=false is set explicitly. */
  CROO_SIMULATE: boolFromString("true"),

  // ── Hire state machine timeouts (SDK_NOTES.md item 2: two event waits) ──
  /** Measured creating->created is routinely 24-40s (items 16, 26); 30s was marginal and cost us Themis's first fire. */
  CROO_ORDER_CREATED_TIMEOUT_MS: z.coerce.number().positive().default(90_000),
  CROO_ORDER_COMPLETED_TIMEOUT_MS: z.coerce.number().positive().default(300_000),
  /** Poll fallback interval (SDK_NOTES.md item 16 — order_created/order_completed WS delivery isn't reliable enough alone). */
  CROO_POLL_INTERVAL_MS: z.coerce.number().positive().default(5_000),

  // ── Hired agents ──
  REPO_DOCTOR_SERVICE_ID: z.string().default(""),
  VERIS_SERVICE_ID: z.string().default(""),
  /** Themis "Fact-Check" — confirmed live (89% completion). Escalation degrades gracefully if this is ever emptied out again. */
  ESCALATION_AGENT_SERVICE_ID: z.string().default(""),
  CROO_BUYER_API_KEY: z.string().default(""),

  // ── Per-hire price guard (SDK_NOTES.md item 23) ──
  // Providers quote dynamically at accept time; a real VERIS negotiation
  // quoted $20 for a $0.10-listed service (item 22). The ACTUAL quote is
  // checked against these caps after order_created, before payOrder — a
  // quote above the cap is refused, never paid. Caps are absolute USDC,
  // set ~5x the known list prices ($0.01 / $0.10 / ~$0.01–0.03).
  REPO_DOCTOR_MAX_COST_USDC: z.coerce.number().min(0).default(0.05),
  VERIS_MAX_COST_USDC: z.coerce.number().min(0).default(0.5),
  ESCALATION_MAX_COST_USDC: z.coerce.number().min(0).default(0.15),

  // ── Escalation engine (SPEC §7, FR-14/15/16) — Themis is the confirmed tiebreaker ──
  /** Estimate used ONLY for the pre-hire budget-cap check; the real cost_usdc recorded always comes from the actual hire, never this estimate. */
  ESCALATION_ASSUMED_COST_USDC: z.coerce.number().min(0).default(0.03),
  /**
   * Themis's score is a continuous 0..1 "confidence this is safe to ship."
   * decisiveness = |score - 0.5| * 2 (0 at the 0.5 midpoint, 1 at either
   * extreme). Below this threshold Themis is treated as inconclusive —
   * pre-escalation decision/confidence stand, unchanged, no fabrication.
   */
  ESCALATION_MIN_DECISIVENESS: z.coerce.number().min(0).max(1).default(0.1),
  /** Cap on escalation purchases per event. M4 only ever buys one (no retry loop); kept configurable per SPEC §7 ("cap escalations, default 1") for forward-compatibility. */
  ESCALATION_MAX_ATTEMPTS: z.coerce.number().int().min(0).default(1),

  // ── Event detection sources ──
  GITHUB_TOKEN: z.string().default(""),
  OSV_API_URL: z.string().url().default("https://api.osv.dev/v1/query"),
  NPM_REGISTRY_URL: z.string().url().default("https://registry.npmjs.org"),
  POLL_INTERVAL_MINUTES: z.coerce.number().positive().default(15),
  /**
   * Caps how many of a repo's (production-first) npm dependencies get
   * polled per sweep — both the provider's one-time baseline scan (M5,
   * must fit inside the order's delivery window) and each poll-loop cycle.
   * A repo with hundreds of dependencies would otherwise blow the SLA and
   * hammer OSV/npm/GitHub every cycle; discovered-but-unpolled deps are
   * still indexed in the `dependencies` table, just not queried for events.
   */
  BASELINE_SCAN_MAX_DEPS: z.coerce.number().int().positive().default(40),

  // ── Notifications ──
  SLACK_WEBHOOK_URL: z.string().default(""),

  // ── Dashboard read API ──
  // A minimal read-only HTTP surface (src/api/server.ts) so a dashboard
  // deployed separately from this worker (e.g. Vercel, which shares no
  // filesystem with wherever this process runs) can read decisions/repos
  // without a direct SQLite file read. Only needed for that split-host
  // deployment; local dev reads agent/quorum.db directly and ignores this.
  DASHBOARD_API_PORT: z.coerce.number().int().positive().default(8080),
  /** Shared secret with the dashboard's QUORUM_AGENT_API_KEY. Empty = the read API refuses every request rather than serving unauthenticated. */
  DASHBOARD_API_KEY: z.string().default(""),

  // ── State ──
  DATABASE_URL: z.string().default("file:./quorum.db"),

  // ── Dev / offline mode ──
  USE_FIXTURES: boolFromString("false"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // ── Risk policy thresholds (SPEC §5) ──
  RISK_POLICY_STARTUP_CONFIDENCE_TARGET: z.coerce.number().min(0).max(1).default(0.7),
  RISK_POLICY_STARTUP_BUDGET_CAP_USDC: z.coerce.number().min(0).default(0.05),
  RISK_POLICY_STARTUP_ESCALATION_AGGRESSIVENESS: z
    .enum(["rarely", "on_disagreement", "on_uncertainty"])
    .default("rarely"),

  RISK_POLICY_BALANCED_CONFIDENCE_TARGET: z.coerce.number().min(0).max(1).default(0.8),
  RISK_POLICY_BALANCED_BUDGET_CAP_USDC: z.coerce.number().min(0).default(0.15),
  RISK_POLICY_BALANCED_ESCALATION_AGGRESSIVENESS: z
    .enum(["rarely", "on_disagreement", "on_uncertainty"])
    .default("on_disagreement"),

  RISK_POLICY_ENTERPRISE_CONFIDENCE_TARGET: z.coerce.number().min(0).max(1).default(0.9),
  RISK_POLICY_ENTERPRISE_BUDGET_CAP_USDC: z.coerce.number().min(0).default(0.25),
  RISK_POLICY_ENTERPRISE_ESCALATION_AGGRESSIVENESS: z
    .enum(["rarely", "on_disagreement", "on_uncertainty"])
    .default("on_uncertainty"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

/** Names of env keys whose values must never appear in logs. */
export const SECRET_ENV_KEYS: readonly (keyof Env)[] = [
  "CROO_API_KEY",
  "CROO_BUYER_API_KEY",
  "GITHUB_TOKEN",
  "SLACK_WEBHOOK_URL",
  "DASHBOARD_API_KEY",
];

export { loadEnv, envSchema };
