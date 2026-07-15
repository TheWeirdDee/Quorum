import type { QuorumDb } from "./db.js";

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
export async function insertOrder(db: QuorumDb, input: InsertOrderInput): Promise<OrderRecord> {
  const [created] = await db<OrderRecord>("orders")
    .insert({
      direction: input.direction,
      order_id: input.orderId,
      negotiation_id: input.negotiationId ?? null,
      counterparty: input.counterparty ?? null,
      decision_id: input.decisionId ?? null,
      status: input.status ?? "pending",
      cost_usdc: input.costUsdc ?? null,
      tx: input.tx ?? null,
      requirements_json: input.requirements ? JSON.stringify(input.requirements) : null,
      created_at: new Date().toISOString(),
    })
    .returning("*");

  if (!created) throw new Error("Failed to read back order after insert");
  return created;
}

export async function getOrderByOrderId(db: QuorumDb, orderId: string): Promise<OrderRecord | undefined> {
  return db<OrderRecord>("orders").where({ order_id: orderId }).first();
}

/**
 * Atomically claims an inbound order for baseline processing.
 *
 * The provider backlog sweep and WebSocket handler can see the same paid
 * order, and a process restart can see it again later. A process-local Set
 * only protects one runtime; this persisted compare-and-swap makes outbound
 * spending at-most-once for the lifetime of the order. We deliberately do
 * not reclaim `processing` after a crash: failing closed lets CAP refund the
 * buyer instead of risking another set of autonomous purchases.
 */
export async function claimInboundOrderProcessing(db: QuorumDb, orderId: string): Promise<boolean> {
  const changed = await db("orders")
    .where({ order_id: orderId, direction: "inbound" })
    .whereIn("status", ["pending", "accepted", "paid"])
    .update({ status: "processing" });
  return changed === 1;
}

/** Updates the local lifecycle marker used by the provider's replay guard. */
export async function updateOrderStatus(db: QuorumDb, orderId: string, status: string): Promise<void> {
  await db("orders").where({ order_id: orderId }).update({ status });
}
