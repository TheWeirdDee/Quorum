import { NextResponse } from "next/server";
import { safeAll, safeGet } from "../../../lib/db";
import type { RepoListItem } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RepoRow {
  id: number;
  github_url: string;
  risk_policy: RepoListItem["risk_policy"];
  budget_cap_usdc: number | null;
  notify_type: string | null;
  created_at: string;
}

export async function GET() {
  const rows = safeAll<RepoRow>(
    `SELECT id, github_url, risk_policy, budget_cap_usdc, notify_type, created_at FROM repos ORDER BY id`,
  );

  const repos: RepoListItem[] = rows.map((row) => {
    const countRow = safeGet<{ n: number }>(`SELECT COUNT(*) as n FROM dependencies WHERE repo_id = ?`, [row.id]);
    return { ...row, dependencyCount: countRow?.n ?? 0 };
  });

  return NextResponse.json({ repos });
}
