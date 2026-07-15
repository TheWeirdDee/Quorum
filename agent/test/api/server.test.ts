import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startReadApi } from "../../src/api/server.js";
import { closeDb, openDb, type QuorumDb } from "../../src/store/db.js";
import { insertDecision } from "../../src/store/decisions.js";
import { upsertDependency } from "../../src/store/dependencies.js";
import { upsertRepo } from "../../src/store/repos.js";

const API_KEY = "test-secret-key";

describe("read API server", () => {
  let db: QuorumDb;
  let server: ReturnType<typeof startReadApi>;
  let baseUrl: string;

  beforeEach(async () => {
    db = await openDb(":memory:");
    server = startReadApi(db, 0, API_KEY);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb(db);
  });

  it("returns 401 with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/decisions`);
    expect(res.status).toBe(401);
  });

  it("GET /health returns 200 without auth (uptime pinger target), leaking nothing", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 with the wrong key", async () => {
    const res = await fetch(`${baseUrl}/repos`, { headers: { authorization: "Bearer wrong-key" } });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown route, even when authorized", async () => {
    const res = await fetch(`${baseUrl}/nope`, { headers: { authorization: `Bearer ${API_KEY}` } });
    expect(res.status).toBe(404);
  });

  it("GET /decisions returns the same shape the dashboard's local read produces", async () => {
    await insertDecision(db, {
      payload: { schema: "quorum.decision.v1", dependency: "left-pad@1.3.1", decision: "SHIP" },
      decision: "SHIP",
      confidence: 0.95,
      totalSpendUsdc: 0.11,
      decidedAt: "2026-07-10T00:00:00Z",
    });

    const res = await fetch(`${baseUrl}/decisions`, { headers: { authorization: `Bearer ${API_KEY}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decisions: unknown[] };
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0]).toMatchObject({
      decision: "SHIP",
      confidence: 0.95,
      total_spend_usdc: 0.11,
      payload: { dependency: "left-pad@1.3.1" },
    });
  });

  it("GET /decisions respects the limit query param, capped at 200", async () => {
    for (let i = 0; i < 3; i++) {
      await insertDecision(db, {
        payload: { schema: "quorum.decision.v1", dependency: `pkg${i}@1.0.0` },
        decision: "ARCHIVED_NO_ACTION",
        confidence: 1,
        totalSpendUsdc: 0,
        decidedAt: "2026-07-10T00:00:00Z",
      });
    }

    const res = await fetch(`${baseUrl}/decisions?limit=2`, { headers: { authorization: `Bearer ${API_KEY}` } });
    const body = (await res.json()) as { decisions: unknown[] };
    expect(body.decisions).toHaveLength(2);
  });

  it("GET /repos includes a per-repo dependency count", async () => {
    const repo = await upsertRepo(db, { githubUrl: "https://github.com/acme/thing", riskPolicy: "balanced" });
    await upsertDependency(db, { repoId: repo.id, name: "left-pad" });
    await upsertDependency(db, { repoId: repo.id, name: "express" });

    const res = await fetch(`${baseUrl}/repos`, { headers: { authorization: `Bearer ${API_KEY}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repos: { dependencyCount: number; github_url: string }[] };
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0]).toMatchObject({ github_url: "https://github.com/acme/thing", dependencyCount: 2 });
  });

  it("refuses every request when no API key is configured, even a correct-looking one", async () => {
    const noKeyServer = startReadApi(db, 0, "");
    await new Promise<void>((resolve) => noKeyServer.once("listening", resolve));
    const { port } = noKeyServer.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/repos`, { headers: { authorization: "Bearer " } });
      expect(res.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => noKeyServer.close(() => resolve()));
    }
  });
});
