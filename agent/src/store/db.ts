import knex, { type Knex } from "knex";
import { env } from "../config/env.js";
import { migrate } from "./schema.js";

/** Strips a `file:` prefix from a DATABASE_URL, leaving `:memory:` untouched. */
export function resolveDatabasePath(databaseUrl: string): string {
  if (databaseUrl === ":memory:") return databaseUrl;
  return databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : databaseUrl;
}

export type QuorumDb = Knex;

export function isPostgresUrl(databaseUrl: string): boolean {
  return databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://");
}

/**
 * Opens the durable store. Local development and tests keep using SQLite;
 * production can point DATABASE_URL at Neon (or any PostgreSQL server).
 */
export async function openDb(databaseUrl: string = env.DATABASE_URL): Promise<QuorumDb> {
  const normalizedUrl = databaseUrl.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedUrl) && !isPostgresUrl(normalizedUrl)) {
    throw new Error("DATABASE_URL must be a file: SQLite path or a postgres:// / postgresql:// URL");
  }

  const db = isPostgresUrl(normalizedUrl)
    ? knex({
        client: "pg",
        connection: normalizedUrl,
        pool: { min: 0, max: 5 },
        acquireConnectionTimeout: 15_000,
      })
    : knex({
        client: "better-sqlite3",
        connection: { filename: resolveDatabasePath(normalizedUrl) },
        useNullAsDefault: true,
        pool: {
          min: 1,
          max: 1,
          afterCreate(connection: { pragma: (sql: string) => unknown }, done: (err: Error | null, connection: unknown) => void) {
            try {
              connection.pragma("foreign_keys = ON");
              if (normalizedUrl !== ":memory:") connection.pragma("journal_mode = WAL");
              done(null, connection);
            } catch (err) {
              done(err instanceof Error ? err : new Error(String(err)), connection);
            }
          },
        },
      });

  try {
    await migrate(db);
    return db;
  } catch (err) {
    await db.destroy();
    throw err;
  }
}

export async function closeDb(db: QuorumDb): Promise<void> {
  await db.destroy();
}
