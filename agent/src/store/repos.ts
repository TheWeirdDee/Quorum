import type Database from "better-sqlite3";

export interface RepoRecord {
  id: number;
  github_url: string;
  risk_policy: "startup" | "balanced" | "enterprise";
  budget_cap_usdc: number | null;
  notify_type: string | null;
  notify_webhook: string | null;
  created_at: string;
}

export interface RegisterRepoInput {
  githubUrl: string;
  riskPolicy: "startup" | "balanced" | "enterprise";
  budgetCapUsdc?: number;
  notifyType?: string;
  notifyWebhook?: string;
}

/** Registers a repo, or returns the existing record if already registered. */
export function upsertRepo(db: Database.Database, input: RegisterRepoInput): RepoRecord {
  const existing = getRepoByUrl(db, input.githubUrl);
  if (existing) return existing;

  const result = db
    .prepare(
      `INSERT INTO repos (github_url, risk_policy, budget_cap_usdc, notify_type, notify_webhook, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.githubUrl,
      input.riskPolicy,
      input.budgetCapUsdc ?? null,
      input.notifyType ?? null,
      input.notifyWebhook ?? null,
      new Date().toISOString(),
    );

  const created = getRepoById(db, Number(result.lastInsertRowid));
  if (!created) throw new Error(`Failed to read back repo ${input.githubUrl} after insert`);
  return created;
}

export function getRepoByUrl(db: Database.Database, githubUrl: string): RepoRecord | undefined {
  return db.prepare(`SELECT * FROM repos WHERE github_url = ?`).get(githubUrl) as RepoRecord | undefined;
}

export function getRepoById(db: Database.Database, id: number): RepoRecord | undefined {
  return db.prepare(`SELECT * FROM repos WHERE id = ?`).get(id) as RepoRecord | undefined;
}

/** All registered repos, for the poll loop to iterate each cycle. */
export function listRepos(db: Database.Database): RepoRecord[] {
  return db.prepare(`SELECT * FROM repos ORDER BY id`).all() as RepoRecord[];
}
