import type { AgentClient } from "@croo-network/sdk";
import { logger } from "../config/logger.js";
import type { QuorumDb } from "../store/db.js";
import {
  claimInboundOrderProcessing,
  getOrderByOrderId,
  insertOrder,
  updateOrderStatus,
} from "../store/orders.js";
import { parseQuorumRequest, type QuorumRequest } from "./requestSchema.js";

/**
 * FR-3: the buyer's input lives in negotiation.requirements and is NOT on
 * the order_paid event — cache it keyed by orderId at accept time, with a
 * getOrder -> getNegotiation fallback for the restart case (SPEC §3).
 *
 * Two layers: an in-memory map (fast path) backed by the durable orders
 * table (survives a provider restart between accept and order_paid — a
 * paid order must never become undeliverable because we forgot what was
 * bought).
 */
export class RequirementsCache {
  private readonly memory = new Map<string, QuorumRequest>();

  constructor(
    private readonly db: QuorumDb,
    private readonly client: AgentClient,
  ) {}

  /** Called at accept time: persist the validated request under the new orderId. */
  async remember(orderId: string, negotiationId: string, request: QuorumRequest): Promise<void> {
    this.memory.set(orderId, request);
    await insertOrder(this.db, {
      direction: "inbound",
      orderId,
      negotiationId,
      status: "accepted",
      requirements: request,
    });
  }

  /** Persisted at-most-once guard for any work that can spend outbound USDC. */
  claimForProcessing(orderId: string): Promise<boolean> {
    return claimInboundOrderProcessing(this.db, orderId);
  }

  async markStatus(orderId: string, status: string): Promise<void> {
    await updateOrderStatus(this.db, orderId, status);
  }

  /**
   * Called at order_paid time. Resolution order: memory -> durable DB -> the
   * getOrder->getNegotiation network fallback. Returns undefined only when
   * all three fail — the caller should rejectOrder rather than guess.
   */
  async recall(orderId: string): Promise<QuorumRequest | undefined> {
    const fromMemory = this.memory.get(orderId);
    if (fromMemory) return fromMemory;

    const row = await getOrderByOrderId(this.db, orderId);
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
      // A restart can recover requirements from CAP even when the original
      // local accept-time row was lost. Recreate the durable row so the
      // at-most-once processing claim still applies before any outbound hire.
      if (!row) {
        await insertOrder(this.db, {
          direction: "inbound",
          orderId,
          negotiationId: order.negotiationId,
          status: "accepted",
          requirements: parsed.request,
        });
      }
      this.memory.set(orderId, parsed.request);
      return parsed.request;
    } catch (err) {
      logger.error(`RequirementsCache: network fallback failed for ${orderId}:`, err);
      return undefined;
    }
  }
}
