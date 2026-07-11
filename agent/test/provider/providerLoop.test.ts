import { EventType, type AgentClient, type Event, type EventStream, type EventTypeName } from "@croo-network/sdk";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuorumDecision } from "../../src/decision/schema.js";
import { startProviderLoop, sweepProviderBacklog } from "../../src/provider/providerLoop.js";
import { RequirementsCache } from "../../src/provider/requirementsCache.js";
import { openDb } from "../../src/store/db.js";

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
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  afterEach(() => db.close());

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

  it("on order_paid, recalls cached requirements, runs the baseline scan, and delivers the decision (FR-4)", async () => {
    const { stream, fire } = fakeStream();
    const client = { deliverOrder: vi.fn().mockResolvedValue(undefined), rejectOrder: vi.fn() } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    cache.remember("order-2", "neg-2", { repo: "https://github.com/acme/thing", ecosystems: ["npm"], risk_policy: "balanced" });
    const runBaseline = vi.fn().mockResolvedValue({ decision: FAKE_DECISION });

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-2" });
    await flush();

    expect(runBaseline).toHaveBeenCalledWith(expect.objectContaining({ repo: "https://github.com/acme/thing" }));
    expect(client.deliverOrder).toHaveBeenCalledWith("order-2", { deliverableType: "schema", deliverableSchema: JSON.stringify(FAKE_DECISION) });
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

  it("rejects the order when the baseline scan / deliverOrder throws after acceptance", async () => {
    const { stream, fire } = fakeStream();
    const client = {
      deliverOrder: vi.fn().mockRejectedValue(new Error("network blip")),
      rejectOrder: vi.fn().mockResolvedValue(undefined),
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    cache.remember("order-3", "neg-3", { repo: "https://github.com/acme/thing", ecosystems: ["npm"], risk_policy: "balanced" });
    const runBaseline = vi.fn().mockResolvedValue({ decision: FAKE_DECISION });

    startProviderLoop({ client, stream, requirementsCache: cache, runBaseline });
    fire(EventType.OrderPaid, { type: EventType.OrderPaid, raw: {}, order_id: "order-3" });
    await flush();

    expect(client.rejectOrder).toHaveBeenCalledWith("order-3", expect.any(String));
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
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  afterEach(() => db.close());

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
    } as unknown as AgentClient;
    const cache = new RequirementsCache(db, client);
    cache.remember("order-paid-missed", "neg-x", { repo: "https://github.com/acme/thing", ecosystems: ["npm"], risk_policy: "balanced" });
    const runBaseline = vi.fn().mockResolvedValue({ decision: FAKE_DECISION });

    await sweepProviderBacklog({ client, requirementsCache: cache, runBaseline });

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
