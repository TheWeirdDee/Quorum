import type Database from "better-sqlite3";

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
export function insertDecision(db: Database.Database, input: InsertDecisionInput): DecisionRecord {
  const result = db
    .prepare(
      `INSERT INTO decisions (event_id, payload_json, decision, confidence, total_spend_usdc, decided_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.eventId ?? null,
      JSON.stringify(input.payload),
      input.decision,
      input.confidence,
      input.totalSpendUsdc,
      input.decidedAt,
    );

  const created = db
    .prepare(`SELECT * FROM decisions WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as DecisionRecord | undefined;
  if (!created) throw new Error("Failed to read back decision after insert");
  return created;
}

/** Most recent decisions first, for the dashboard's event feed (direct local read, or via the read API — see src/api/server.ts). */
export function listRecentDecisions(db: Database.Database, limit = 50): DecisionRecord[] {
  return db
    .prepare(
      `SELECT id, event_id, payload_json, decision, confidence, total_spend_usdc, decided_at
       FROM decisions ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as DecisionRecord[];
}
