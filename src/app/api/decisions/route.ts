import { NextResponse } from "next/server";
import { agentApiConfigured, fetchFromAgent } from "../../../lib/agentApi";
import { safeAll } from "../../../lib/db";
import type { DecisionListItem, QuorumDecision } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DecisionRow {
  id: number;
  payload_json: string;
  decision: string;
  confidence: number;
  total_spend_usdc: number;
  decided_at: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requested = Number(searchParams.get("limit") ?? "50");
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 50, 200);

  if (agentApiConfigured()) {
    try {
      const data = await fetchFromAgent<{ decisions: DecisionListItem[] }>(`/decisions?limit=${limit}`);
      return NextResponse.json(data);
    } catch (err) {
      return NextResponse.json({ decisions: [], error: err instanceof Error ? err.message : "agent API unreachable" }, { status: 502 });
    }
  }

  const rows = safeAll<DecisionRow>(
    `SELECT id, payload_json, decision, confidence, total_spend_usdc, decided_at FROM decisions ORDER BY id DESC LIMIT ?`,
    [limit],
  );

  const decisions: DecisionListItem[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as QuorumDecision;
      decisions.push({
        id: row.id,
        decision: row.decision as DecisionListItem["decision"],
        confidence: row.confidence,
        total_spend_usdc: row.total_spend_usdc,
        decided_at: row.decided_at,
        payload,
      });
    } catch {
      // A row with unparseable payload_json would be a storage bug, not something to crash the feed over — skip it.
    }
  }

  return NextResponse.json({ decisions });
}
