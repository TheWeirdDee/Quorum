import type Database from "better-sqlite3";

export interface DependencyRecord {
  id: number;
  repo_id: number;
  name: string;
  version: string | null;
  ecosystem: string;
  is_production: 0 | 1;
  github_repo_url: string | null;
  maintainers_json: string | null;
  is_archived: 0 | 1 | null;
  license: string | null;
  created_at: string;
}

export interface UpsertDependencyInput {
  repoId: number;
  name: string;
  version?: string;
  ecosystem?: string;
  isProduction?: boolean;
  githubRepoUrl?: string;
}

/** Inserts a dependency for a repo, or returns the existing record. */
export function upsertDependency(db: Database.Database, input: UpsertDependencyInput): DependencyRecord {
  const ecosystem = input.ecosystem ?? "npm";
  const existing = getDependency(db, input.repoId, input.name, ecosystem);
  if (existing) return existing;

  const result = db
    .prepare(
      `INSERT INTO dependencies (repo_id, name, version, ecosystem, is_production, github_repo_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.repoId,
      input.name,
      input.version ?? null,
      ecosystem,
      input.isProduction === false ? 0 : 1,
      input.githubRepoUrl ?? null,
      new Date().toISOString(),
    );

  const created = getDependencyById(db, Number(result.lastInsertRowid));
  if (!created) throw new Error(`Failed to read back dependency ${input.name} after insert`);
  return created;
}

export function getDependency(
  db: Database.Database,
  repoId: number,
  name: string,
  ecosystem = "npm",
): DependencyRecord | undefined {
  return db
    .prepare(`SELECT * FROM dependencies WHERE repo_id = ? AND name = ? AND ecosystem = ?`)
    .get(repoId, name, ecosystem) as DependencyRecord | undefined;
}

export function getDependencyById(db: Database.Database, id: number): DependencyRecord | undefined {
  return db.prepare(`SELECT * FROM dependencies WHERE id = ?`).get(id) as DependencyRecord | undefined;
}

export function listDependenciesForRepo(db: Database.Database, repoId: number): DependencyRecord[] {
  return db.prepare(`SELECT * FROM dependencies WHERE repo_id = ?`).all(repoId) as DependencyRecord[];
}

/** Cheaper than listDependenciesForRepo(...).length for the dashboard's per-repo count — avoids materializing every row. */
export function countDependenciesForRepo(db: Database.Database, repoId: number): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM dependencies WHERE repo_id = ?`).get(repoId) as { n: number };
  return row.n;
}
