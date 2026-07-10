import type { AgentClient } from "@croo-network/sdk";
import type Database from "better-sqlite3";
import { logger } from "../config/logger.js";
import { getOrderByOrderId, insertOrder } from "../store/orders.js";
import { parseQuorumRequest, type QuorumRequest } from "./requestSchema.js";

/**
 * FR-3: the buyer's input lives in negotiation.requirements and is NOT on
 * the order_paid event — cache it keyed by orderId at accept time, with a
 * getOrder -> getNegotiation fallback for the restart case (SPEC §3).
 *
 * Two layers: an in-memory map (fast path) backed by the SQLite orders
 * table (survives a provider restart between accept and order_paid — a
 * paid order must never become undeliverable because we forgot what was
 * bought).
 */
export class RequirementsCache {
  private readonly memory = new Map<string, QuorumRequest>();

  constructor(
    private readonly db: Database.Database,
    private readonly client: AgentClient,
  ) {}

  /** Called at accept time: persist the validated request under the new orderId. */
  remember(orderId: string, negotiationId: string, request: QuorumRequest): void {
    this.memory.set(orderId, request);
    insertOrder(this.db, {
      direction: "inbound",
      orderId,
      negotiationId,
      status: "accepted",
      requirements: request,
    });
  }

  /**
   * Called at order_paid time. Resolution order: memory -> SQLite -> the
   * getOrder->getNegotiation network fallback. Returns undefined only when
   * all three fail — the caller should rejectOrder rather than guess.
   */
  async recall(orderId: string): Promise<QuorumRequest | undefined> {
    const fromMemory = this.memory.get(orderId);
    if (fromMemory) return fromMemory;

    const row = getOrderByOrderId(this.db, orderId);
    if (row?.requirements_json) {
      try {
        const parsed = parseQuorumRequest(row.requirements_json);
        if (parsed.ok) {
          this.memory.set(orderId, parsed.request);
          return parsed.request;
        }
      } catch {
        // fall through to the network fallback
      }
    }

    logger.warn(`RequirementsCache: no local record for order ${orderId} — falling back to getOrder -> getNegotiation`);
    try {
      const order = await this.client.getOrder(orderId);
      if (!order.negotiationId) return undefined;
      const negotiation = await this.client.getNegotiation(order.negotiationId);
      const parsed = parseQuorumRequest(negotiation.requirements);
      if (!parsed.ok) {
        logger.error(`RequirementsCache: network fallback for ${orderId} returned unparseable requirements: ${parsed.reason}`);
        return undefined;
      }
      this.memory.set(orderId, parsed.request);
      return parsed.request;
    } catch (err) {
      logger.error(`RequirementsCache: network fallback failed for ${orderId}:`, err);
      return undefined;
    }
  }
}
