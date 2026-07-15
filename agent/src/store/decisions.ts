import type { QuorumDb } from "./db.js";

export interface DecisionRecord {
  id: number;
  event_id: number | null;
  payload_json: string;
  decision: string;
  confidence: number;
  total_spend_usdc: number;
  decided_at: string;
}

export interface InsertDecisionInput {
  eventId?: number;
  payload: unknown;
  decision: string;
  confidence: number;
  totalSpendUsdc: number;
  decidedAt: string;
}

/** Persists a quorum.decision.v1 payload. Built for later milestones (Risk Gate / merge); unused by the Event Detector. */
export async function insertDecision(db: QuorumDb, input: InsertDecisionInput): Promise<DecisionRecord> {
  const [created] = await db<DecisionRecord>("decisions")
    .insert({
      event_id: input.eventId ?? null,
      payload_json: JSON.stringify(input.payload),
      decision: input.decision,
      confidence: input.confidence,
      total_spend_usdc: input.totalSpendUsdc,
      decided_at: input.decidedAt,
    })
    .returning("*");

  if (!created) throw new Error("Failed to read back decision after insert");
  return created;
}

/** Most recent decisions first, for the dashboard's event feed (direct local read, or via the read API — see src/api/server.ts). */
export async function listRecentDecisions(db: QuorumDb, limit = 50): Promise<DecisionRecord[]> {
  return db<DecisionRecord>("decisions")
    .select("id", "event_id", "payload_json", "decision", "confidence", "total_spend_usdc", "decided_at")
    .orderBy("id", "desc")
    .limit(limit);
}
