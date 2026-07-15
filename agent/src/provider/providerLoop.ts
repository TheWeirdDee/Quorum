import {
  DeliverableType,
  EventType,
  NegotiationStatus,
  OrderStatus,
  type AgentClient,
  type Event,
  type EventStream,
  type Order,
} from "@croo-network/sdk";
import { logger } from "../config/logger.js";
import { pollUntil } from "../croo/pollFallback.js";
import type { QuorumDecision } from "../decision/schema.js";
import { parseQuorumRequest, type QuorumRequest } from "./requestSchema.js";
import type { RequirementsCache } from "./requirementsCache.js";

export interface ProviderLoopParams {
  client: AgentClient;
  stream: EventStream;
  requirementsCache: RequirementsCache;
  /** Runs the baseline scan for an accepted+paid registration. Injectable so tests can exercise the negotiation/order lifecycle without the full investigate() pipeline; production callers pass `runBaselineScan` bound to db/client/correlator. */
  runBaseline: (
    request: QuorumRequest,
    context?: { deadlineMs?: number | undefined },
  ) => Promise<{ decision: QuorumDecision }>;
  /** Pause before the single delivery retry; tests pass ~0 so they don't sleep. */
  deliverRetryDelayMs?: number;
}

/**
 * Flattens a decision into the wire shape the Agent Store LISTING declares:
 * the service's deliverable schema (filled in on the Configure page)
 * documents `event`/`gate`/`lenses`/`escalation` as compact-JSON *strings*,
 * not nested objects — a store-form limitation, same one the request side
 * hit in reverse (see normalizeWireRequest).
 *
 * CONFIRMED live (order 893a8395, 2026-07-11): CROO's deliverable validator
 * treats an EMPTY value on a required field as missing — `APIError:
 * INVALID_DELIVERABLE: disagreement: missing_required` — and a baseline
 * decision legitimately carries disagreement:"" and receipts:[]. Pad those
 * with honest explanatory text on the wire only; the canonical nested form
 * (schemas/, the DB, the dashboard) keeps its true empty values, and the
 * padding text is unmistakably not a fabricated tx hash.
 */
export function toWireDeliverable(decision: QuorumDecision): Record<string, unknown> {
  return {
    ...decision,
    event: JSON.stringify(decision.event),
    gate: JSON.stringify(decision.gate),
    lenses: JSON.stringify(decision.lenses),
    escalation: JSON.stringify(decision.escalation),
    disagreement: decision.disagreement || "none — no disagreement to report for this decision",
    receipts: decision.receipts.length > 0 ? decision.receipts : ["none — no opinions were purchased for this decision"],
  };
}

async function safeRejectOrder(client: AgentClient, orderId: string, reason: string): Promise<boolean> {
  try {
    await client.rejectOrder(orderId, reason);
    return true;
  } catch (err) {
    logger.error(`providerLoop: rejectOrder(${orderId}) also failed:`, err);
    return false;
  }
}

/**
 * The backlog sweep (below) and the WS handlers can race on the same
 * negotiation/order — e.g. an event arriving mid-sweep. The backend rejects
 * the duplicate accept/deliver anyway, but these guards keep the logs clean
 * and the work single-flight.
 */
const inFlightNegotiations = new Set<string>();
const inFlightOrders = new Set<string>();
const DELIVERY_HEADROOM_MS = 60_000;
const PAID_STATUS_WAIT_MS = 60_000;

const TERMINAL_BEFORE_PAID = new Set<string>([
  OrderStatus.Completed,
  OrderStatus.Rejected,
  OrderStatus.Expired,
  OrderStatus.CreateFailed,
  OrderStatus.PayFailed,
]);

async function waitForPaidOrder(client: AgentClient, orderId: string): Promise<Order> {
  const first = await client.getOrder(orderId);
  if (first.status === OrderStatus.Paid) return first;
  if (TERMINAL_BEFORE_PAID.has(first.status)) {
    throw new Error(`order ${orderId} reached terminal status "${first.status}" before baseline spending began`);
  }
  return pollUntil({
    poll: async () => {
      const order = await client.getOrder(orderId);
      return order.status === OrderStatus.Paid ? order : undefined;
    },
    timeoutMs: PAID_STATUS_WAIT_MS,
    pollIntervalMs: 3_000,
    timeoutMessage: `order ${orderId} did not reach 'paid' status within 60s`,
  });
}

async function handleNegotiationCreated(client: AgentClient, cache: RequirementsCache, event: Event): Promise<void> {
  const negotiationId = event.negotiation_id;
  if (!negotiationId) {
    logger.error("providerLoop: order_negotiation_created event carried no negotiation_id");
    return;
  }
  if (inFlightNegotiations.has(negotiationId)) return;
  inFlightNegotiations.add(negotiationId);
  try {
    await processNegotiation(client, cache, negotiationId);
  } finally {
    inFlightNegotiations.delete(negotiationId);
  }
}

async function processNegotiation(client: AgentClient, cache: RequirementsCache, negotiationId: string): Promise<void> {

  let requirements: string;
  try {
    requirements = (await client.getNegotiation(negotiationId)).requirements;
  } catch (err) {
    logger.error(`providerLoop: getNegotiation(${negotiationId}) failed:`, err);
    return;
  }

  const parsed = parseQuorumRequest(requirements);
  if (!parsed.ok) {
    logger.info(`providerLoop: rejecting negotiation ${negotiationId} — ${parsed.reason}`);
    try {
      await client.rejectNegotiation(negotiationId, parsed.reason);
    } catch (err) {
      logger.error(`providerLoop: rejectNegotiation(${negotiationId}) failed:`, err);
    }
    return;
  }

  try {
    const accepted = await client.acceptNegotiation(negotiationId);
    await cache.remember(accepted.order.orderId, negotiationId, parsed.request);
    logger.info(`providerLoop: accepted negotiation ${negotiationId} -> order ${accepted.order.orderId} (repo=${parsed.request.repo})`);
  } catch (err) {
    logger.error(`providerLoop: acceptNegotiation(${negotiationId}) failed — buyer's funds were never locked, nothing to release:`, err);
  }
}

async function handleOrderPaid(
  client: AgentClient,
  cache: RequirementsCache,
  runBaseline: ProviderLoopParams["runBaseline"],
  event: Event,
  deliverRetryDelayMs: number,
): Promise<void> {
  const orderId = event.order_id;
  if (!orderId) {
    logger.error("providerLoop: order_paid event carried no order_id");
    return;
  }
  if (inFlightOrders.has(orderId)) return;
  inFlightOrders.add(orderId);
  try {
    await processPaidOrder(client, cache, runBaseline, orderId, deliverRetryDelayMs);
  } finally {
    inFlightOrders.delete(orderId);
  }
}

async function processPaidOrder(
  client: AgentClient,
  cache: RequirementsCache,
  runBaseline: ProviderLoopParams["runBaseline"],
  orderId: string,
  deliverRetryDelayMs: number,
): Promise<void> {
  const request = await cache.recall(orderId);
  if (!request) {
    logger.error(`providerLoop: order ${orderId} paid but no cached quorum.register requirements were found — rejecting to release escrow`);
    await safeRejectOrder(client, orderId, "internal error: registration requirements could not be recovered for this order");
    return;
  }

  if (!(await cache.claimForProcessing(orderId))) {
    logger.info(`providerLoop: order ${orderId} already claimed or finalized locally; skipping replay`);
    return;
  }

  let paidOrder: Order;
  try {
    paidOrder = await waitForPaidOrder(client, orderId);
  } catch (err) {
    logger.error(`providerLoop: refusing to spend for order ${orderId} because paid status was not confirmed:`, err);
    const rejected = await safeRejectOrder(client, orderId, "parent order was not confirmed paid before baseline processing");
    await cache.markStatus(orderId, rejected ? "rejected" : "failed");
    return;
  }

  const slaDeadlineMs = Date.parse(paidOrder.slaDeadline);
  const spendingDeadlineMs = Number.isFinite(slaDeadlineMs) ? slaDeadlineMs - DELIVERY_HEADROOM_MS : undefined;
  if (spendingDeadlineMs !== undefined && spendingDeadlineMs <= Date.now()) {
    logger.warn(`providerLoop: order ${orderId} has insufficient SLA time remaining; rejecting without outbound spend`);
    const rejected = await safeRejectOrder(client, orderId, "insufficient SLA time remaining to run the baseline safely");
    await cache.markStatus(orderId, rejected ? "rejected" : "failed");
    return;
  }

  let decision: QuorumDecision;
  try {
    ({ decision } =
      spendingDeadlineMs === undefined
        ? await runBaseline(request)
        : await runBaseline(request, { deadlineMs: spendingDeadlineMs }));
  } catch (err) {
    logger.error(`providerLoop: baseline scan failed for order ${orderId}:`, err);
    const rejected = await safeRejectOrder(client, orderId, "internal error running the baseline scan");
    await cache.markStatus(orderId, rejected ? "rejected" : "failed");
    return;
  }

  // Re-check after the scan: the parent can expire while external work runs.
  // Never attempt delivery into a terminal/non-paid status.
  try {
    const current = await client.getOrder(orderId);
    if (current.status !== OrderStatus.Paid) {
      logger.warn(`providerLoop: order ${orderId} became "${current.status}" before delivery; stopping`);
      await cache.markStatus(orderId, current.status);
      return;
    }
  } catch (err) {
    logger.error(`providerLoop: final status check failed for ${orderId}; refusing an unsafe delivery attempt:`, err);
    await cache.markStatus(orderId, "failed");
    return;
  }

  const deliverable = { deliverableType: DeliverableType.Schema, deliverableSchema: JSON.stringify(toWireDeliverable(decision)) };
  try {
    await client.deliverOrder(orderId, deliverable);
    await cache.markStatus(orderId, "delivered");
    logger.info(`providerLoop: delivered order ${orderId} (repo=${request.repo}, decision=${decision.decision})`);
  } catch (err) {
    logger.error(`providerLoop: deliverOrder(${orderId}) failed — retrying once in ${deliverRetryDelayMs}ms:`, err);
    await new Promise((resolve) => setTimeout(resolve, deliverRetryDelayMs));
    try {
      await client.deliverOrder(orderId, deliverable);
      await cache.markStatus(orderId, "delivered");
      logger.info(`providerLoop: delivered order ${orderId} on retry (repo=${request.repo}, decision=${decision.decision})`);
    } catch (retryErr) {
      logger.error(`providerLoop: deliverOrder(${orderId}) retry also failed — rejecting to release escrow:`, retryErr);
      const rejected = await safeRejectOrder(client, orderId, "internal error delivering the decision");
      await cache.markStatus(orderId, rejected ? "rejected" : "failed");
    }
  }
}

/**
 * FR-1..FR-4, SPEC §2/§3: Quorum's provider-side WS loop for `quorum.register`.
 * Subscribes on the SAME connection the requester side (M3/M4 hires) uses —
 * SPEC's single order-ID map living in RequirementsCache/OrderEventCorrelator
 * is what keeps served vs bought orders from being confused, not two sockets.
 *
 * order_negotiation_created -> validate (Zod) -> acceptNegotiation (caching
 * requirements under the returned orderId, FR-3) or rejectNegotiation
 * BEFORE any funds lock (FR-2). order_paid -> recall requirements -> run the
 * baseline scan -> deliverOrder (FR-4). Every handler is wrapped so a
 * failure is logged, never thrown into the SDK's event dispatcher, and
 * never leaves an order stuck: an unrecoverable failure past acceptance
 * calls rejectOrder to release escrow (SPEC §3).
 */
export function startProviderLoop(params: ProviderLoopParams): void {
  const { client, stream, requirementsCache, runBaseline, deliverRetryDelayMs = 5_000 } = params;

  stream.on(EventType.NegotiationCreated, (event) => {
    void handleNegotiationCreated(client, requirementsCache, event);
  });

  stream.on(EventType.OrderPaid, (event) => {
    void handleOrderPaid(client, requirementsCache, runBaseline, event, deliverRetryDelayMs);
  });
}

/**
 * Catches up on provider work whose WS event was never seen. CONFIRMED
 * needed in production: the provider loop is otherwise purely event-driven,
 * so a negotiation created while the worker was down (e.g. Render's free
 * tier stopping an idle instance) sat in "pending" forever — a real buyer's
 * real order did exactly this. Polls the two states the WS pair would have
 * announced: pending negotiations (missed order_negotiation_created) and
 * paid-but-undelivered orders (missed order_paid), and routes each through
 * the same single-flight handlers the events use. Run once at startup and
 * on an interval; safe to overlap with live events thanks to the in-flight
 * guards + the backend rejecting duplicate accepts/deliveries.
 *
 * Vocabulary trap (SDK_NOTES.md item 14): listNegotiations wants role
 * "provider"|"requester" while listOrders wants "provider"|"buyer" — both
 * are "provider" here, but don't copy these values across endpoints.
 */
export async function sweepProviderBacklog(params: Omit<ProviderLoopParams, "stream">): Promise<void> {
  const { client, requirementsCache, runBaseline, deliverRetryDelayMs = 5_000 } = params;

  // Deliberately NOT passing a server-side `status` filter to either list
  // call: a live pending negotiation went unfound by
  // listNegotiations({ status: "pending" }) — the endpoint evidently doesn't
  // filter by the same status vocabulary the objects carry. Fetch the page
  // and match locally against the SDK's own enums instead, and log the
  // statuses actually seen so a future mismatch diagnoses itself from logs.
  try {
    const negotiations = await client.listNegotiations({ role: "provider", pageSize: 50 });
    if (negotiations.length > 0) {
      logger.info(
        `providerLoop sweep: ${negotiations.length} provider negotiation(s), statuses: ${[...new Set(negotiations.map((n) => n.status))].join(", ")}`,
      );
    }
    for (const negotiation of negotiations.filter((n) => n.status === NegotiationStatus.Pending)) {
      logger.info(`providerLoop sweep: found pending negotiation ${negotiation.negotiationId} with no seen event — processing`);
      await handleNegotiationCreated(client, requirementsCache, {
        type: EventType.NegotiationCreated,
        raw: {},
        negotiation_id: negotiation.negotiationId,
      });
    }
  } catch (err) {
    logger.error("providerLoop sweep: listNegotiations failed:", err);
  }

  try {
    const orders = await client.listOrders({ role: "provider", pageSize: 50 });
    if (orders.length > 0) {
      logger.info(
        `providerLoop sweep: ${orders.length} provider order(s), statuses: ${[...new Set(orders.map((o) => o.status))].join(", ")}`,
      );
    }
    for (const order of orders.filter((o) => o.status === OrderStatus.Paid)) {
      logger.info(`providerLoop sweep: found paid undelivered order ${order.orderId} with no seen event — processing`);
      await handleOrderPaid(
        client,
        requirementsCache,
        runBaseline,
        { type: EventType.OrderPaid, raw: {}, order_id: order.orderId },
        deliverRetryDelayMs,
      );
    }
  } catch (err) {
    logger.error("providerLoop sweep: listOrders failed:", err);
  }
}
