import type Database from "better-sqlite3";

export type OrderDirection = "inbound" | "outbound";

export interface OrderRecord {
  id: number;
  direction: OrderDirection;
  order_id: string;
  negotiation_id: string | null;
  counterparty: string | null;
  decision_id: number | null;
  status: string;
  cost_usdc: number | null;
  tx: string | null;
  requirements_json: string | null;
  created_at: string;
}

export interface InsertOrderInput {
  direction: OrderDirection;
  orderId: string;
  negotiationId?: string;
  counterparty?: string;
  decisionId?: number;
  status?: string;
  costUsdc?: number;
  tx?: string;
  requirements?: unknown;
}

/**
 * Records a CAP order. `direction` distinguishes orders Quorum serves (inbound,
 * as provider) from orders it buys (outbound, as requester) on the shared
 * WebSocket connection — see SPEC §6.
 */
export function insertOrder(db: Database.Database, input: InsertOrderInput): OrderRecord {
  const result = db
    .prepare(
      `INSERT INTO orders (direction, order_id, negotiation_id, counterparty, decision_id, status, cost_usdc, tx, requirements_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.direction,
      input.orderId,
      input.negotiationId ?? null,
      input.counterparty ?? null,
      input.decisionId ?? null,
      input.status ?? "pending",
      input.costUsdc ?? null,
      input.tx ?? null,
      input.requirements ? JSON.stringify(input.requirements) : null,
      new Date().toISOString(),
    );

  const created = db
    .prepare(`SELECT * FROM orders WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as OrderRecord | undefined;
  if (!created) throw new Error("Failed to read back order after insert");
  return created;
}

export function getOrderByOrderId(db: Database.Database, orderId: string): OrderRecord | undefined {
  return db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderId) as OrderRecord | undefined;
}
