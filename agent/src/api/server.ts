import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { countDependenciesForRepo } from "../store/dependencies.js";
import { listRecentDecisions } from "../store/decisions.js";
import type { QuorumDb } from "../store/db.js";
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

async function handleDecisions(db: QuorumDb, url: URL, res: ServerResponse): Promise<void> {
  const requested = Number(url.searchParams.get("limit") ?? "50");
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 50, 200);

  const decisions: unknown[] = [];
  for (const row of await listRecentDecisions(db, limit)) {
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

async function handleRepos(db: QuorumDb, res: ServerResponse): Promise<void> {
  const rows = await listRepos(db);
  const repos = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      github_url: row.github_url,
      risk_policy: row.risk_policy,
      budget_cap_usdc: row.budget_cap_usdc,
      notify_type: row.notify_type,
      created_at: row.created_at,
      dependencyCount: await countDependenciesForRepo(db, row.id),
    })),
  );
  sendJson(res, 200, { repos });
}

async function handleRequest(db: QuorumDb, apiKey: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!isAuthorized(req, apiKey)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (req.method === "GET" && url.pathname === "/decisions") {
    await handleDecisions(db, url, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/repos") {
    await handleRepos(db, res);
    return;
  }
  sendJson(res, 404, { error: "not found" });
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
  db: QuorumDb,
  port: number = env.DASHBOARD_API_PORT,
  apiKey: string = env.DASHBOARD_API_KEY,
): Server {
  const server = createServer((req, res) => {
    void handleRequest(db, apiKey, req, res).catch((err) => {
      logger.error("readApi: request failed:", err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      else res.end();
    });
  });

  server.listen(port, () => {
    logger.info(`readApi: listening on :${port}${apiKey ? "" : " (DASHBOARD_API_KEY unset — refusing every request)"}`);
  });

  return server;
}
