import { afterEach, describe, expect, it } from "vitest";
import { closeDb, isPostgresUrl, openDb, resolveDatabasePath, type QuorumDb } from "../../src/store/db.js";
import { upsertRepo } from "../../src/store/repos.js";

describe("database backend selection", () => {
  let db: QuorumDb | undefined;

  afterEach(async () => {
    if (db) await closeDb(db);
    db = undefined;
  });

  it("recognizes both PostgreSQL URL spellings used by Neon", () => {
    expect(isPostgresUrl("postgres://user:pass@example.test/db?sslmode=require")).toBe(true);
    expect(isPostgresUrl("postgresql://user:pass@example.test/db?sslmode=require")).toBe(true);
    expect(isPostgresUrl("file:./quorum.db")).toBe(false);
    expect(isPostgresUrl(":memory:")).toBe(false);
  });

  it("keeps the existing SQLite path behavior for local development", () => {
    expect(resolveDatabasePath("file:./quorum.db")).toBe("./quorum.db");
    expect(resolveDatabasePath(":memory:")).toBe(":memory:");
  });

  it("bootstraps the same five tables on the local SQLite backend", async () => {
    db = await openDb(":memory:");
    for (const table of ["repos", "dependencies", "seen_events", "decisions", "orders"]) {
      expect(await db.schema.hasTable(table)).toBe(true);
    }
  });

  it("makes concurrent repo registration idempotent", async () => {
    db = await openDb(":memory:");
    const input = { githubUrl: "https://github.com/acme/concurrent", riskPolicy: "balanced" as const };
    const [first, second] = await Promise.all([upsertRepo(db, input), upsertRepo(db, input)]);
    expect(first.id).toBe(second.id);
    const count = await db("repos").count<{ n: string | number }>("id as n").first();
    expect(Number(count?.n)).toBe(1);
  });
});
