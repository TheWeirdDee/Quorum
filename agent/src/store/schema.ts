import type Database from "better-sqlite3";

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_url TEXT NOT NULL UNIQUE,
    risk_policy TEXT NOT NULL,
    budget_cap_usdc REAL,
    notify_type TEXT,
    notify_webhook TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL REFERENCES repos(id),
    name TEXT NOT NULL,
    version TEXT,
    ecosystem TEXT NOT NULL DEFAULT 'npm',
    is_production INTEGER NOT NULL DEFAULT 1,
    github_repo_url TEXT,
    maintainers_json TEXT,
    is_archived INTEGER,
    license TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(repo_id, name, ecosystem)
  )`,
  `CREATE TABLE IF NOT EXISTS seen_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER REFERENCES repos(id),
    dependency TEXT NOT NULL,
    type TEXT NOT NULL,
    ref TEXT NOT NULL,
    severity_hint TEXT NOT NULL,
    source TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    context_json TEXT,
    first_seen_at TEXT NOT NULL,
    UNIQUE(dependency, type, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER REFERENCES seen_events(id),
    payload_json TEXT NOT NULL,
    decision TEXT NOT NULL,
    confidence REAL NOT NULL,
    total_spend_usdc REAL NOT NULL,
    decided_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    order_id TEXT NOT NULL UNIQUE,
    negotiation_id TEXT,
    counterparty TEXT,
    decision_id INTEGER REFERENCES decisions(id),
    status TEXT NOT NULL DEFAULT 'pending',
    cost_usdc REAL,
    tx TEXT,
    requirements_json TEXT,
    created_at TEXT NOT NULL
  )`,
];

export function migrate(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const statement of MIGRATIONS) {
    db.exec(statement);
  }
}
