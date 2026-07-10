import path from "node:path";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

/**
 * The agent (agent/src/store/db.ts) and this dashboard are separate npm
 * packages sharing one SQLite file — the agent writes (worker/CAP loops),
 * the dashboard only ever reads. WAL mode (set by the agent's own migrate())
 * makes concurrent reads-while-writing safe; nothing here needs to set it.
 * QUORUM_DB_PATH overrides the default for a non-standard layout/deploy.
 */
function resolveDbPath(): string {
  return process.env.QUORUM_DB_PATH ?? path.join(process.cwd(), "agent", "quorum.db");
}

function getDb(): Database.Database {
  db ??= new Database(resolveDbPath(), { fileMustExist: false });
  return db;
}

/**
 * Runs a read query, returning [] if the underlying table doesn't exist yet
 * — the common case before the agent worker has run even once. Any other
 * error (a real query bug, a locked file) still throws.
 */
export function safeAll<T>(sql: string, params: readonly unknown[] = []): T[] {
  try {
    return getDb().prepare(sql).all(...params) as T[];
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return [];
    throw err;
  }
}

export function safeGet<T>(sql: string, params: readonly unknown[] = []): T | undefined {
  try {
    return getDb().prepare(sql).get(...params) as T | undefined;
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) return undefined;
    throw err;
  }
}
