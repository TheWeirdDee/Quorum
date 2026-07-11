import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type Database from "better-sqlite3";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { countDependenciesForRepo } from "../store/dependencies.js";
import { listRecentDecisions } from "../store/decisions.js";
import { listRepos } from "../store/repos.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

/** Constant-effort compare would be ideal, but this is a low-value target (read-only data, no funds move through it) — a plain compare is a reasonable simplification here. */
function isAuthorized(req: IncomingMessage, apiKey: string): boolean {
  if (!apiKey) return false;
  return req.headers.authorization === `Bearer ${apiKey}`;
}

function handleDecisions(db: Database.Database, url: URL, res: ServerResponse): void {
  const requested = Number(url.searchParams.get("limit") ?? "50");
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 50, 200);

  const decisions: unknown[] = [];
  for (const row of listRecentDecisions(db, limit)) {
    try {
      decisions.push({
        id: row.id,
        decision: row.decision,
        confidence: row.confidence,
        total_spend_usdc: row.total_spend_usdc,
        decided_at: row.decided_at,
        payload: JSON.parse(row.payload_json),
      });
    } catch (err) {
      logger.error(`readApi: decision ${row.id} has unparseable payload_json:`, err);
    }
  }
  sendJson(res, 200, { decisions });
}

function handleRepos(db: Database.Database, res: ServerResponse): void {
  const repos = listRepos(db).map((row) => ({
    id: row.id,
    github_url: row.github_url,
    risk_policy: row.risk_policy,
    budget_cap_usdc: row.budget_cap_usdc,
    notify_type: row.notify_type,
    created_at: row.created_at,
    dependencyCount: countDependenciesForRepo(db, row.id),
  }));
  sendJson(res, 200, { repos });
}

/**
 * A minimal read-only HTTP surface for the dashboard when it's deployed
 * separately from this worker (e.g. Vercel, which shares no filesystem with
 * wherever the worker actually runs — see DEPLOY.md). Every write to the
 * store happens through the CAP provider/poll loops elsewhere in this
 * process; this server only ever reads. Deliberately dependency-free (plain
 * node:http) rather than pulling in a web framework for two GET routes.
 */
export function startReadApi(
  db: Database.Database,
  port: number = env.DASHBOARD_API_PORT,
  apiKey: string = env.DASHBOARD_API_KEY,
): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // Unauthenticated on purpose: uptime pingers (which keep a free-tier
    // host awake) can't send headers worth trusting, and this leaks nothing
    // — a bare 200. Everything else stays behind the key.
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!isAuthorized(req, apiKey)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/decisions") {
      handleDecisions(db, url, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/repos") {
      handleRepos(db, res);
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });

  server.listen(port, () => {
    logger.info(`readApi: listening on :${port}${apiKey ? "" : " (DASHBOARD_API_KEY unset — refusing every request)"}`);
  });

  return server;
}
