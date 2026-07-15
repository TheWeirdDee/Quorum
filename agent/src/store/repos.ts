import type { QuorumDb } from "./db.js";

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
export async function upsertRepo(db: QuorumDb, input: RegisterRepoInput): Promise<RepoRecord> {
  const existing = await getRepoByUrl(db, input.githubUrl);
  if (existing) return existing;

  await db("repos")
    .insert({
      github_url: input.githubUrl,
      risk_policy: input.riskPolicy,
      budget_cap_usdc: input.budgetCapUsdc ?? null,
      notify_type: input.notifyType ?? null,
      notify_webhook: input.notifyWebhook ?? null,
      created_at: new Date().toISOString(),
    })
    .onConflict("github_url")
    .ignore();

  const created = await getRepoByUrl(db, input.githubUrl);
  if (!created) throw new Error(`Failed to read back repo ${input.githubUrl} after insert`);
  return created;
}

export async function getRepoByUrl(db: QuorumDb, githubUrl: string): Promise<RepoRecord | undefined> {
  return db<RepoRecord>("repos").where({ github_url: githubUrl }).first();
}

export async function getRepoById(db: QuorumDb, id: number): Promise<RepoRecord | undefined> {
  return db<RepoRecord>("repos").where({ id }).first();
}

/** All registered repos, for the poll loop to iterate each cycle. */
export async function listRepos(db: QuorumDb): Promise<RepoRecord[]> {
  return db<RepoRecord>("repos").orderBy("id");
}
