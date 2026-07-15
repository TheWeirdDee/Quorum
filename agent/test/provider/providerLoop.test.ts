import { EventType, type AgentClient, type Event, type EventStream, type EventTypeName } from "@croo-network/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuorumDecision } from "../../src/decision/schema.js";
import { startProviderLoop, sweepProviderBacklog } from "../../src/provider/providerLoop.js";
import { RequirementsCache } from "../../src/provider/requirementsCache.js";
import { closeDb, openDb, type QuorumDb } from "../../src/store/db.js";
import { getOrderByOrderId } from "../../src/store/orders.js";

function fakeStream() {
  const handlers = new Map<string, (event: Event) => void>();
  const stream = {
    on: (eventType: EventTypeName | string, handler: (event: Event) => void) => {
      handlers.set(eventType, handler);
    },
  } as unknown as EventStream;
  return { stream, fire: (type: string, event: Event) => handlers.get(type)?.(event) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

const VALID_REQUEST_JSON = JSON.stringify({ repo: "https://github.com/acme/thing", risk_policy: "balanced" });

const FAKE_DECISION: QuorumDecision = {
  schema: "quorum.decision.v1",
  dependency: "acme/thing@registration",
  event: { type: "baseline_scan", detail: "", source: "system", ref: "https://github.com/acme/thing", severity_hint: "info" },
  gate: { investigated: false, reason: "no investigatable trust events at registration" },
  decision: "ARCHIVED_NO_ACTION",
  confidence: 1,
  lenses: {},
  escalation: { triggered: false },
  disagreement: "",
  total_spend_usdc: 0,
  receipts: [],
  decided_at: new Date().toISOString(),
};

describe("startProviderLoop", () => {
  let db: QuorumDb;

  beforeEach(async () => {
    db = await openDb(":memory:");
  });

  afterEach(async () => closeDb(db));

  it("accepts a valid negotiation and caches the requirements under the returned orderId (FR-2, FR-3)", async () => {
    const { stream, fire } = fakeStream();
    const client = {
      getNegotiation: vi.fn().mockResolvedValue({ requirements: VALID_REQUEST_JSON }),
      acceptNegotiation: vi.fn().mockResolvedValue({ negotiation: {}, order: { orderId: "order-1" } }),
      rejectNegotiation: vi.fn(),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline: vi.fn() });
    fire(EventType.NegotiationCreated, { type: EventType.NegotiationCreated, raw: {}, negotiation_id: "neg-1" });
    await flush();

    expect(client.acceptNegotiation).toHaveBeenCalledWith("neg-1");
    const recalled = await cache.recall("order-1");
    expect(recalled?.repo).toBe("https://github.com/acme/thing");
  });

  it("rejects a negotiation with malformed requirements BEFORE accepting (FR-2)", async () => {
    const { stream, fire } = fakeStream();
    const client = {
      getNegotiation: vi.fn().mockResolvedValue({ requirements: JSON.stringify({ repo: "not-a-github-url", risk_policy: "balanced" }) }),
      acceptNegotiation: vi.fn(),
      rejectNegotiation: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline: vi.fn() });
    fire(EventType.NegotiationCreated, { type: EventType.NegotiationCreated, raw: {}, negotiation_id: "neg-2" });
    await flush();

    expect(client.rejectNegotiation).toHaveBeenCalledWith("neg-2", expect.stringContaining("invalid quorum.register request"));
    expect(client.acceptNegotiation).not.toHaveBeenCalled();
  });

  it("on order_paid, waits for 'paid' status and delivers the LISTING's wire shape: nested blocks as compact-JSON strings", async () => {
    const { stream, fire } = fakeStream();
    const client = {
      deliverOrder: vi.fn().mockResolvedValue(undefined),
      rejectOrder: vi.fn(),
      getOrder: vi.fn().mockResolvedValue({ status: "paid" }),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    await cache.remember("order-2", "neg-2", { repo: "https://github.com/acme/thing", ecosystems: ["npm"], risk_policy: "balanced" });
    const runBaseline = vi.fn().mockResolvedValue({ decision: FAKE_DECISION });

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline, deliverRetryDelayMs: 1 });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-2" });
    await flush();

    expect(runBaseline).toHaveBeenCalledWith(expect.objectContaining({ repo: "https://github.com/acme/thing" }));
    expect(client.getOrder).toHaveBeenCalledWith("order-2");
    expect(client.deliverOrder).toHaveBeenCalledTimes(1);
    const [orderId, req] = (client.deliverOrder as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { deliverableType: string; deliverableSchema: string }];
    expect(orderId).toBe("order-2");
    expect(req.deliverableType).toBe("schema");
    const wire = JSON.parse(req.deliverableSchema) as Record<string, unknown>;
    // The store listing declares these as strings — nested objects got a real order's delivery rejected.
    expect(typeof wire["event"]).toBe("string");
    expect(typeof wire["gate"]).toBe("string");
    expect(typeof wire["lenses"]).toBe("string");
    expect(typeof wire["escalation"]).toBe("string");
    expect(JSON.parse(wire["event"] as string)).toEqual(FAKE_DECISION.event);
    expect(wire["decision"]).toBe("ARCHIVED_NO_ACTION");
    // CROO rejects empty required fields as missing (INVALID_DELIVERABLE,
    // order 893a8395) — a baseline decision's ""/[] must be padded on the wire.
    expect(wire["disagreement"]).toBeTruthy();
    expect((wire["receipts"] as string[]).length).toBeGreaterThan(0);
    expect(client.rejectOrder).not.toHaveBeenCalled();
  });

  it("rejects the order to release escrow when no cached requirements can be found for a paid order", async () => {
    const { stream, fire } = fakeStream();
    const client = {
      deliverOrder: vi.fn(),
      rejectOrder: vi.fn().mockResolvedValue(undefined),
      getOrder: vi.fn().mockRejectedValue(new Error("not found")),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline: vi.fn() });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-missing" });
    await flush();

    expect(client.deliverOrder).not.toHaveBeenCalled();
    expect(client.rejectOrder).toHaveBeenCalledWith("order-missing", expect.any(String));
  });

  it("retries delivery once, then rejects with a delivery-specific reason when both attempts fail", async () => {
    const { stream, fire } = fakeStream();
    const client = {
      deliverOrder: vi.fn().mockRejectedValue(new Error("network blip")),
      rejectOrder: vi.fn().mockResolvedValue(undefined),
      getOrder: vi.fn().mockResolvedValue({ status: "paid" }),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    await cache.remember("order-3", "neg-3", { repo: "https://github.com/acme/thing", ecosystems: ["npm"], risk_policy: "balanced" });
    const runBaseline = vi.fn().mockResolvedValue({ decision: FAKE_DECISION });

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline, deliverRetryDelayMs: 1 });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-3" });
    await flush();

    expect(client.deliverOrder).toHaveBeenCalledTimes(2);
    expect(client.rejectOrder).toHaveBeenCalledWith("order-3", "internal error delivering the decision");
  });

  it("succeeds when the delivery retry lands (transient first failure never rejects the order)", async () => {
    const { stream, fire } = fakeStream();
    const client = {
      deliverOrder: vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(undefined),
      rejectOrder: vi.fn(),
      getOrder: vi.fn().mockResolvedValue({ status: "paid" }),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    await cache.remember("order-4", "neg-4", { repo: "https://github.com/acme/thing", ecosystems: ["npm"], risk_policy: "balanced" });
    const runBaseline = vi.fn().mockResolvedValue({ decision: FAKE_DECISION });

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline, deliverRetryDelayMs: 1 });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-4" });
    await flush();

    expect(client.deliverOrder).toHaveBeenCalledTimes(2);
    expect(client.rejectOrder).not.toHaveBeenCalled();
  });

  it("persists an at-most-once claim so a later paid event cannot rerun outbound spending", async () => {
    const { stream, fire } = fakeStream();
    const client = {
      deliverOrder: vi.fn().mockResolvedValue(undefined),
      rejectOrder: vi.fn(),
      getOrder: vi.fn().mockResolvedValue({ status: "paid", slaDeadline: "" }),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    await cache.remember("order-once", "neg-once", {
      repo: "https://github.com/acme/thing",
      ecosystems: ["npm"],
      risk_policy: "balanced",
    });
    const runBaseline = vi.fn().mockResolvedValue({ decision: FAKE_DECISION });

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline, deliverRetryDelayMs: 1 });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-once" });
    await flush();
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-once" });
    await flush();

    expect(runBaseline).toHaveBeenCalledTimes(1);
    expect(client.deliverOrder).toHaveBeenCalledTimes(1);
    expect((await getOrderByOrderId(db, "order-once"))?.status).toBe("delivered");
  });

  it("does not run the baseline when the parent order is already terminal", async () => {
    const { stream, fire } = fakeStream();
    const client = {
      deliverOrder: vi.fn(),
      rejectOrder: vi.fn().mockResolvedValue(undefined),
      getOrder: vi.fn().mockResolvedValue({ status: "expired", slaDeadline: "" }),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    await cache.remember("order-expired", "neg-expired", {
      repo: "https://github.com/acme/thing",
      ecosystems: ["npm"],
      risk_policy: "balanced",
    });
    const runBaseline = vi.fn();

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-expired" });
    await flush();

    expect(runBaseline).not.toHaveBeenCalled();
    expect(client.deliverOrder).not.toHaveBeenCalled();
  });

  it("reserves one minute of the parent SLA and passes the spending deadline to the baseline", async () => {
    const { stream, fire } = fakeStream();
    const slaDeadline = new Date(Date.now() + 10 * 60_000).toISOString();
    const client = {
      deliverOrder: vi.fn().mockResolvedValue(undefined),
      rejectOrder: vi.fn(),
      getOrder: vi.fn().mockResolvedValue({ status: "paid", slaDeadline }),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    await cache.remember("order-deadline", "neg-deadline", {
      repo: "https://github.com/acme/thing",
      ecosystems: ["npm"],
      risk_policy: "balanced",
    });
    const runBaseline = vi.fn().mockResolvedValue({ decision: FAKE_DECISION });

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-deadline" });
    await flush();

    expect(runBaseline).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "https://github.com/acme/thing" }),
      { deadlineMs: Date.parse(slaDeadline) - 60_000 },
    );
  });

  it("logs and does nothing when an event carries no negotiation_id/order_id", async () => {
    const { stream, fire } = fakeStream();
    const client = { getNegotiation: vi.fn(), deliverOrder: vi.fn() } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline: vi.fn() });
    fire(EventType.NegotiationCreated, { type: EventType.NegotiationCreated, raw: {} });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {} });
    await flush();

    expect(client.getNegotiation).not.toHaveBeenCalled();
    expect(client.deliverOrder).not.toHaveBeenCalled();
  });
});

describe("sweepProviderBacklog", () => {
  let db: QuorumDb;

  beforeEach(async () => {
    db = await openDb(":memory:");
  });

  afterEach(async () => closeDb(db));

  it("accepts a pending negotiation whose order_negotiation_created event was never seen (worker was down)", async () => {
    const client = {
      // No server-side status filter: a real pending negotiation went
      // unfound when one was passed — the sweep filters locally instead.
      listNegotiations: vi.fn().mockResolvedValue([
        { negotiationId: "neg-already-done", status: "accepted" },
        { negotiationId: "neg-missed", status: "pending" },
      ]),
      listOrders: vi.fn().mockResolvedValue([]),
      getNegotiation: vi.fn().mockResolvedValue({ requirements: VALID_REQUEST_JSON }),
      acceptNegotiation: vi.fn().mockResolvedValue({ negotiation: {}, order: { orderId: "order-missed" } }),
      rejectNegotiation: vi.fn(),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);

    await sweepProviderBacklog({ client, requirementsCache: cache, runBaseline: vi.fn() });

    expect(client.listNegotiations).toHaveBeenCalledWith({ role: "provider", pageSize: 50 });
    expect(client.acceptNegotiation).toHaveBeenCalledTimes(1);
    expect(client.acceptNegotiation).toHaveBeenCalledWith("neg-missed");
    const recalled = await cache.recall("order-missed");
    expect(recalled?.repo).toBe("https://github.com/acme/thing");
  });

  it("delivers a paid order whose order_paid event was never seen", async () => {
    const client = {
      listNegotiations: vi.fn().mockResolvedValue([]),
      listOrders: vi.fn().mockResolvedValue([
        { orderId: "order-done", status: "completed" },
        { orderId: "order-paid-missed", status: "paid" },
      ]),
      deliverOrder: vi.fn().mockResolvedValue(undefined),
      rejectOrder: vi.fn(),
      getOrder: vi.fn().mockResolvedValue({ status: "paid" }),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    await cache.remember("order-paid-missed", "neg-x", { repo: "https://github.com/acme/thing", ecosystems: ["npm"], risk_policy: "balanced" });
    const runBaseline = vi.fn().mockResolvedValue({ decision: FAKE_DECISION });

    await sweepProviderBacklog({ client, requirementsCache: cache, runBaseline, deliverRetryDelayMs: 1 });

    expect(client.listOrders).toHaveBeenCalledWith({ role: "provider", pageSize: 50 });
    expect(runBaseline).toHaveBeenCalledTimes(1);
    expect(client.deliverOrder).toHaveBeenCalledWith("order-paid-missed", expect.objectContaining({ deliverableType: "schema" }));
  });

  it("survives both list calls failing (logs, never throws)", async () => {
    const client = {
      listNegotiations: vi.fn().mockRejectedValue(new Error("api down")),
      listOrders: vi.fn().mockRejectedValue(new Error("api down")),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);

    await expect(sweepProviderBacklog({ client, requirementsCache: cache, runBaseline: vi.fn() })).resolves.toBeUndefined();
  });
});
