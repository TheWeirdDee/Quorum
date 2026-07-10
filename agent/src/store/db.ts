import Database from "better-sqlite3";
import { env } from "../config/env.js";
import { migrate } from "./schema.js";

/** Strips a `file:` prefix from a DATABASE_URL, leaving `:memory:` untouched. */
export function resolveDatabasePath(databaseUrl: string): string {
  if (databaseUrl === ":memory:") return databaseUrl;
  return databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : databaseUrl;
}

export function openDb(databaseUrl: string = env.DATABASE_URL): Database.Database {
  const db = new Database(resolveDatabasePath(databaseUrl));
  migrate(db);
  return db;
}
