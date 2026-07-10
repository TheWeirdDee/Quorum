import { APIError, OrderStatus, type AgentClient, type Delivery } from "@croo-network/sdk";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { OrderEventCorrelator } from "./orderCorrelator.js";
import { pollUntil, raceEventAndPoll } from "./pollFallback.js";

export type HireFailureStage =
  | "simulate_missing_fixture"
  | "negotiate"
  | "await_order_created"
  | "price_guard_refused"
  | "pay"
  | "await_order_completed"
  | "get_delivery"
  | "parse";

export interface HireSuccess<T> {
  ok: true;
  simulated: boolean;
  verdict: T;
  orderId: string;
  tx: string;
  costUsdc: number;
}

export interface HireFailure {
  ok: false;
  simulated: boolean;
  stage: HireFailureStage;
  reason: string;
  orderId?: string;
}

export type HireOutcome<T> = HireSuccess<T> | HireFailure;

export interface HireAgentParams<T> {
  client: AgentClient;
  correlator: OrderEventCorrelator;
  serviceId: string;
  requirements: Record<string, unknown>;
  /** Zod-validates and normalizes the raw deliverable; throw to signal an invalid shape. */
  parseDeliverable: (delivery: Delivery) => T;
  /**
   * Required when CROO_SIMULATE is true. A stand-in Delivery (e.g. built
   * from fixtures/agent-responses/*.json) run through the same
   * parseDeliverable adapter, so the simulate path exercises the real
   * parsing/normalization code — it just never touches the network or
   * moves money. tx/orderId are labeled SIMULATED, never a hash shape that
   * could be mistaken for a real settlement.
   */
  simulatedDelivery?: Delivery | undefined;
  timeouts?: { orderCreatedMs?: number; orderCompletedMs?: number } | undefined;
  /** Defaults to env.CROO_SIMULATE; overridable so callers (and tests) don't depend on process.env at import time. */
  simulate?: boolean | undefined;
  /**
   * Price guard (SDK_NOTES.md items 22–23): providers quote dynamically at
   * accept time, and a real VERIS negotiation quoted $20 for a $0.10-listed
   * service. The ACTUAL quoted cost — read off the created order before
   * payOrder — must not exceed this cap, or the hire is refused with a
   * structured failure and the unpaid order is left to expire. Undefined =
   * no guard (tests/simulate); every real adapter passes its env cap.
   */
  maxCostUsdc?: number | undefined;
}

/**
 * The effective quoted cost of an order, in USDC. `feeAmount` when present
 * and nonzero, else `price` — NOT price alone: the successful real VERIS
 * order carried price=$20 with feeAmount=$0.10 and charged ~the fee, and the
 * SDK's own pre-pay balance check demanded exactly the feeAmount value on
 * the refused order (SDK_NOTES.md item 22). Guarding on price would refuse
 * every normal VERIS hire.
 */
export function quotedCostUsdc(order: { price?: string; feeAmount?: string | undefined }): number {
  const fee = order.feeAmount !== undefined && order.feeAmount !== "" ? Number(order.feeAmount) : 0;
  if (Number.isFinite(fee) && fee > 0) return fee / 1_000_000;
  return usdcFromBaseUnits(order.price ?? "0");
}

function describeError(err: unknown): string {
  if (err instanceof APIError) return `${err.reason} (HTTP ${err.httpStatus}, code ${err.code})`;
  if (err instanceof Error) return err.message;
  return String(err);
}

function simulatedOrderId(): string {
  return `SIMULATED-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * USDC on Base is 6-decimal; Order.price arrives as a decimal string in base
 * units. Unconfirmed against a real order as of writing — SDK_NOTES.md flags
 * this as the first thing to verify once a real payOrder result lands.
 */
function usdcFromBaseUnits(price: string): number {
  return Number(price) / 1_000_000;
}

/**
 * The requester-side hire primitive (SPEC §2/§6, corrected per SDK_NOTES.md
 * item 2): negotiate -> await order_created -> pay -> await order_completed
 * -> getDelivery -> parse. Every stage that can fail returns a structured
 * HireFailure instead of throwing or hanging; nothing here fabricates a tx
 * hash. CROO_SIMULATE short-circuits before any network call.
 */
export async function hireAgent<T>(params: HireAgentParams<T>): Promise<HireOutcome<T>> {
  const simulate = params.simulate ?? env.CROO_SIMULATE;
  if (simulate) {
    if (!params.simulatedDelivery) {
      const reason = "CROO_SIMULATE=true but no simulatedDelivery fixture was supplied";
      logger.error(`hireAgent(${params.serviceId}) simulate failed: ${reason}`);
      return { ok: false, simulated: true, stage: "simulate_missing_fixture", reason };
    }
    try {
      const verdict = params.parseDeliverable(params.simulatedDelivery);
      logger.info(`hireAgent(${params.serviceId}) SIMULATED — no network call, no spend`);
      return { ok: true, simulated: true, verdict, orderId: simulatedOrderId(), tx: "SIMULATED", costUsdc: 0 };
    } catch (err) {
      const reason = describeError(err);
      logger.error(`hireAgent(${params.serviceId}) simulate parse failed: ${reason}`);
      return { ok: false, simulated: true, stage: "parse", reason };
    }
  }

  let negotiationId: string;
  try {
    const negotiation = await params.client.negotiateOrder({
      serviceId: params.serviceId,
      requirements: JSON.stringify(params.requirements),
    });
    negotiationId = negotiation.negotiationId;
    logger.info(`hireAgent(${params.serviceId}) negotiation created: ${negotiationId}`);
  } catch (err) {
    const reason = describeError(err);
    logger.error(`hireAgent(${params.serviceId}) negotiate failed: ${reason}`);
    return { ok: false, simulated: false, stage: "negotiate", reason };
  }

  let orderId: string;
  try {
    const timeoutMs = params.timeouts?.orderCreatedMs ?? env.CROO_ORDER_CREATED_TIMEOUT_MS;
    orderId = await raceEventAndPoll({
      event: params.correlator.waitForOrderCreated(negotiationId, timeoutMs).then((created) => {
        if (!created.order_id) throw new Error("order_created event carried no order_id");
        return created.order_id;
      }),
      poll: async () => {
        const orders = await params.client.listOrders({ role: "buyer", pageSize: 20 });
        return orders.find((o) => o.negotiationId === negotiationId)?.orderId;
      },
      timeoutMs,
      pollIntervalMs: env.CROO_POLL_INTERVAL_MS,
      timeoutMessage: `Timed out after ${timeoutMs}ms waiting for order_created (negotiationId=${negotiationId}, event + poll fallback both exhausted)`,
    });
    logger.info(`hireAgent(${params.serviceId}) order created: ${orderId}`);
  } catch (err) {
    const reason = describeError(err);
    logger.error(`hireAgent(${params.serviceId}) await order_created failed: ${reason}`);
    return { ok: false, simulated: false, stage: "await_order_created", reason };
  }

  // CONFIRMED live: an order can be discoverable (via poll or event) while
  // still in 'creating' status — its on-chain createOrder tx not yet
  // confirmed — and payOrder rejects that with INVALID_STATUS. Wait for a
  // genuinely payable status before paying, regardless of which path
  // (event or poll) supplied orderId above. The payable order itself is
  // captured for the price guard below.
  let payableOrder: { price?: string; feeAmount?: string | undefined };
  try {
    payableOrder = await pollUntil({
      poll: async () => {
        const order = await params.client.getOrder(orderId);
        return order.status === OrderStatus.Created ? order : undefined;
      },
      timeoutMs: params.timeouts?.orderCreatedMs ?? env.CROO_ORDER_CREATED_TIMEOUT_MS,
      pollIntervalMs: env.CROO_POLL_INTERVAL_MS,
      timeoutMessage: `Order ${orderId} never reached a payable 'created' status within the order_created timeout`,
    });
  } catch (err) {
    const reason = describeError(err);
    logger.error(`hireAgent(${params.serviceId}) waiting for payable status failed: ${reason}`);
    return { ok: false, simulated: false, stage: "await_order_created", reason, orderId };
  }

  // PRICE GUARD (SDK_NOTES.md item 23): the actual quote is only knowable
  // here — after the provider accepted and the order exists, before any
  // money moves. A quote above the cap is refused outright; the unpaid
  // order simply expires at its payDeadline (rejectOrder is provider-side,
  // there is no requester-side cancel — nothing to release, nothing charged).
  if (params.maxCostUsdc !== undefined) {
    const quoted = quotedCostUsdc(payableOrder);
    if (quoted > params.maxCostUsdc) {
      const reason = `price guard refused: provider quoted $${quoted.toFixed(2)} but the per-hire cap for this agent is $${params.maxCostUsdc.toFixed(2)} — order left unpaid to expire, nothing charged`;
      logger.error(`hireAgent(${params.serviceId}) ${reason}`);
      return { ok: false, simulated: false, stage: "price_guard_refused", reason, orderId };
    }
    logger.info(
      `hireAgent(${params.serviceId}) price guard OK: quoted $${quoted.toFixed(2)} <= cap $${params.maxCostUsdc.toFixed(2)}`,
    );
  }

  let tx: string;
  let priceBaseUnits: string;
  try {
    const paid = await params.client.payOrder(orderId);
    tx = paid.txHash;
    priceBaseUnits = paid.order.price;
    logger.info(`hireAgent(${params.serviceId}) paid order ${orderId}: tx ${tx}`);
  } catch (err) {
    const reason = describeError(err);
    logger.error(`hireAgent(${params.serviceId}) pay failed: ${reason}`);
    return { ok: false, simulated: false, stage: "pay", reason, orderId };
  }

  try {
    const timeoutMs = params.timeouts?.orderCompletedMs ?? env.CROO_ORDER_COMPLETED_TIMEOUT_MS;
    await raceEventAndPoll({
      event: params.correlator.waitForOrderCompleted(orderId, timeoutMs).then(() => true as const),
      poll: async () => {
        const order = await params.client.getOrder(orderId);
        return order.status === OrderStatus.Completed ? (true as const) : undefined;
      },
      timeoutMs,
      pollIntervalMs: env.CROO_POLL_INTERVAL_MS,
      timeoutMessage: `Timed out after ${timeoutMs}ms waiting for order_completed (orderId=${orderId}, event + poll fallback both exhausted)`,
    });
    logger.info(`hireAgent(${params.serviceId}) order completed: ${orderId}`);
  } catch (err) {
    const reason = describeError(err);
    logger.error(`hireAgent(${params.serviceId}) await order_completed failed: ${reason}`);
    return { ok: false, simulated: false, stage: "await_order_completed", reason, orderId };
  }

  let delivery: Delivery;
  try {
    delivery = await params.client.getDelivery(orderId);
  } catch (err) {
    const reason = describeError(err);
    logger.error(`hireAgent(${params.serviceId}) getDelivery failed: ${reason}`);
    return { ok: false, simulated: false, stage: "get_delivery", reason, orderId };
  }

  // CONFIRMED live: payOrder()'s embedded order.price can be empty at the
  // moment of payment, even though the same order's price is correctly
  // populated moments later via a fresh getOrder() call. Re-fetch rather
  // than trust the payOrder snapshot — falls back to it only if the
  // re-fetch itself fails, so a transient read error here doesn't fail an
  // otherwise-successful hire.
  try {
    const fresh = await params.client.getOrder(orderId);
    if (fresh.price) priceBaseUnits = fresh.price;
  } catch (err) {
    logger.warn(`hireAgent(${params.serviceId}) could not re-fetch order for price confirmation: ${describeError(err)}`);
  }

  try {
    const verdict = params.parseDeliverable(delivery);
    return { ok: true, simulated: false, verdict, orderId, tx, costUsdc: usdcFromBaseUnits(priceBaseUnits) };
  } catch (err) {
    const reason = describeError(err);
    logger.error(`hireAgent(${params.serviceId}) parse failed: ${reason}`);
    return { ok: false, simulated: false, stage: "parse", reason, orderId };
  }
}
