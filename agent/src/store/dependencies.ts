import type { QuorumDb } from "./db.js";

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
export async function upsertDependency(db: QuorumDb, input: UpsertDependencyInput): Promise<DependencyRecord> {
  const ecosystem = input.ecosystem ?? "npm";
  const existing = await getDependency(db, input.repoId, input.name, ecosystem);
  if (existing) return existing;

  await db("dependencies")
    .insert({
      repo_id: input.repoId,
      name: input.name,
      version: input.version ?? null,
      ecosystem,
      is_production: input.isProduction === false ? 0 : 1,
      github_repo_url: input.githubRepoUrl ?? null,
      created_at: new Date().toISOString(),
    })
    .onConflict(["repo_id", "name", "ecosystem"])
    .ignore();

  const created = await getDependency(db, input.repoId, input.name, ecosystem);
  if (!created) throw new Error(`Failed to read back dependency ${input.name} after insert`);
  return created;
}

export async function getDependency(
  db: QuorumDb,
  repoId: number,
  name: string,
  ecosystem = "npm",
): Promise<DependencyRecord | undefined> {
  return db<DependencyRecord>("dependencies").where({ repo_id: repoId, name, ecosystem }).first();
}

export async function getDependencyById(db: QuorumDb, id: number): Promise<DependencyRecord | undefined> {
  return db<DependencyRecord>("dependencies").where({ id }).first();
}

export async function listDependenciesForRepo(db: QuorumDb, repoId: number): Promise<DependencyRecord[]> {
  return db<DependencyRecord>("dependencies").where({ repo_id: repoId });
}

/** Cheaper than listDependenciesForRepo(...).length for the dashboard's per-repo count — avoids materializing every row. */
export async function countDependenciesForRepo(db: QuorumDb, repoId: number): Promise<number> {
  const row = await db("dependencies").where({ repo_id: repoId }).count<{ n: string | number }>("id as n").first();
  return Number(row?.n ?? 0);
}
