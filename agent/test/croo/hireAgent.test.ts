import type { AgentClient, Delivery, Event, EventStream, EventTypeName, NegotiateOrderRequest } from "@croo-network/sdk";
import { describe, expect, it } from "vitest";
import { hireAgent } from "../../src/croo/hireAgent.js";
import { OrderEventCorrelator } from "../../src/croo/orderCorrelator.js";

/** Flushes pending microtasks (e.g. the negotiateOrder await inside hireAgent) before firing a WS event. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeStream() {
  const handlers = new Map<string, (event: Event) => void>();
  const stream = {
    on: (eventType: EventTypeName | string, handler: (event: Event) => void) => {
      handlers.set(eventType, handler);
    },
  } as unknown as EventStream;
  return { stream, fire: (t: string, e: Event) => handlers.get(t)?.(e) };
}

function fakeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    deliveryId: "delivery-1",
    orderId: "order-1",
    providerAgentId: "provider-1",
    deliverableType: "text",
    deliverableSchema: "",
    deliverableText: JSON.stringify({ verdict: "healthy" }),
    contentHash: "hash",
    status: "accepted",
    submittedAt: "2026-01-01T00:00:00Z",
    verifiedAt: "2026-01-01T00:00:00Z",
    createdTime: "2026-01-01T00:00:00Z",
    updatedTime: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

interface FakeClientOptions {
  negotiateOrder?: (req: NegotiateOrderRequest) => Promise<{ negotiationId: string }>;
  payOrder?: (orderId: string) => Promise<{ txHash: string; order: { price: string } }>;
  getDelivery?: (orderId: string) => Promise<Delivery>;
  listOrders?: () => Promise<Array<{ orderId: string; negotiationId: string }>>;
  getOrder?: (orderId: string) => Promise<{ status: string; price?: string; feeAmount?: string }>;
}

function fakeClient(opts: FakeClientOptions = {}): AgentClient {
  return {
    negotiateOrder: opts.negotiateOrder ?? (async () => ({ negotiationId: "neg-1" })),
    payOrder: opts.payOrder ?? (async () => ({ txHash: "0xREAL", order: { price: "10000" } })),
    getDelivery: opts.getDelivery ?? (async () => fakeDelivery()),
    // Poll fallback + payable-status guard defaults: no match / already payable,
    // so tests relying purely on WS events (fire(...)) aren't affected by polling.
    listOrders: opts.listOrders ?? (async () => []),
    getOrder: opts.getOrder ?? (async () => ({ status: "created" })),
  } as unknown as AgentClient;
}

const parseHealthy = (delivery: Delivery): string => {
  const parsed = JSON.parse(delivery.deliverableText) as { verdict: string };
  return parsed.verdict;
};

describe("hireAgent — simulate: true", () => {
  it("fails cleanly, with no network call, when no simulatedDelivery is supplied", async () => {
    const { stream } = fakeStream();
    const outcome = await hireAgent({
      client: fakeClient(),
      correlator: new OrderEventCorrelator(stream),
      serviceId: "svc-1",
      requirements: { repo: "https://github.com/acme/thing" },
      parseDeliverable: parseHealthy,
      simulate: true,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.stage).toBe("simulate_missing_fixture");
      expect(outcome.simulated).toBe(true);
    }
  });

  it("runs the real parseDeliverable adapter against the simulated fixture, labels the result SIMULATED, costs $0", async () => {
    const { stream } = fakeStream();
    const outcome = await hireAgent({
      client: fakeClient(),
      correlator: new OrderEventCorrelator(stream),
      serviceId: "svc-1",
      requirements: { repo: "https://github.com/acme/thing" },
      parseDeliverable: parseHealthy,
      simulate: true,
      simulatedDelivery: fakeDelivery({ deliverableText: JSON.stringify({ verdict: "healthy" }) }),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.simulated).toBe(true);
      expect(outcome.verdict).toBe("healthy");
      expect(outcome.tx).toBe("SIMULATED");
      expect(outcome.orderId).toMatch(/^SIMULATED-/);
      expect(outcome.costUsdc).toBe(0);
    }
  });

  it("reports a parse-stage failure (not a thrown exception) when the simulated fixture doesn't match the adapter's expectations", async () => {
    const { stream } = fakeStream();
    const badParse = (delivery: Delivery): string => {
      throw new Error(`unexpected shape: ${delivery.deliverableText}`);
    };
    const outcome = await hireAgent({
      client: fakeClient(),
      correlator: new OrderEventCorrelator(stream),
      serviceId: "svc-1",
      requirements: {},
      parseDeliverable: badParse,
      simulate: true,
      simulatedDelivery: fakeDelivery(),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.stage).toBe("parse");
  });
});

describe("hireAgent — simulate: false (real path, faked SDK client)", () => {
  it("runs negotiate -> await order_created -> pay -> await order_completed -> getDelivery -> parse, end to end", async () => {
    const { stream, fire } = fakeStream();
    const correlator = new OrderEventCorrelator(stream);

    const client = fakeClient({
      negotiateOrder: async () => ({ negotiationId: "neg-42" }),
      payOrder: async (orderId) => {
        expect(orderId).toBe("order-42");
        return { txHash: "0xREALTX", order: { price: "10000" } };
      },
      getDelivery: async (orderId) => fakeDelivery({ orderId, deliverableText: JSON.stringify({ verdict: "mixed" }) }),
    });

    const outcomePromise = hireAgent({
      client,
      correlator,
      serviceId: "svc-1",
      requirements: { repo: "https://github.com/acme/thing" },
      parseDeliverable: parseHealthy,
      simulate: false,
      timeouts: { orderCreatedMs: 1000, orderCompletedMs: 1000 },
    });

    // Simulate the counterparty's backend accepting, then delivering.
    await tick();
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-42", order_id: "order-42" });
    await tick();
    fire("order_completed", { type: "order_completed", raw: {}, order_id: "order-42" });

    const outcome = await outcomePromise;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.simulated).toBe(false);
      expect(outcome.verdict).toBe("mixed");
      expect(outcome.tx).toBe("0xREALTX");
      expect(outcome.orderId).toBe("order-42");
      expect(outcome.costUsdc).toBeCloseTo(0.01, 6); // 10000 base units / 1e6
    }
  });

  it("re-fetches price via getOrder when payOrder's embedded order.price is empty (CONFIRMED live bug, SDK_NOTES.md item 17)", async () => {
    const { stream, fire } = fakeStream();
    const correlator = new OrderEventCorrelator(stream);

    const client = fakeClient({
      negotiateOrder: async () => ({ negotiationId: "neg-1" }),
      // payOrder's own response has an empty price, as observed against the real API.
      payOrder: async () => ({ txHash: "0xREALTX", order: { price: "" } }),
      getOrder: async () => ({ status: "created", price: "10000" }),
      getDelivery: async (orderId) => fakeDelivery({ orderId }),
    });

    const outcomePromise = hireAgent({
      client,
      correlator,
      serviceId: "svc-1",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
      timeouts: { orderCreatedMs: 1000, orderCompletedMs: 1000 },
    });

    await tick();
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });
    await tick();
    fire("order_completed", { type: "order_completed", raw: {}, order_id: "order-1" });

    const outcome = await outcomePromise;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.costUsdc).toBeCloseTo(0.01, 6);
    }
  });

  it("falls back to payOrder's price (rather than failing the hire) if the post-pay getOrder re-fetch itself errors", async () => {
    const { stream, fire } = fakeStream();
    const correlator = new OrderEventCorrelator(stream);

    let getOrderCalls = 0;
    const client = fakeClient({
      negotiateOrder: async () => ({ negotiationId: "neg-1" }),
      payOrder: async () => ({ txHash: "0xREALTX", order: { price: "10000" } }),
      getOrder: async () => {
        getOrderCalls += 1;
        // First call is the pre-pay payable-status guard — must succeed for
        // payOrder to be reached at all. Only the post-pay price re-fetch (2nd+ call) errors.
        if (getOrderCalls === 1) return { status: "created" };
        throw new Error("transient read error");
      },
      getDelivery: async (orderId) => fakeDelivery({ orderId }),
    });

    const outcomePromise = hireAgent({
      client,
      correlator,
      serviceId: "svc-1",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
      timeouts: { orderCreatedMs: 1000, orderCompletedMs: 1000 },
    });

    await tick();
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });
    await tick();
    fire("order_completed", { type: "order_completed", raw: {}, order_id: "order-1" });

    const outcome = await outcomePromise;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.costUsdc).toBeCloseTo(0.01, 6);
    }
  });

  it("fails at the negotiate stage without hanging when negotiateOrder rejects", async () => {
    const { stream } = fakeStream();
    const client = fakeClient({
      negotiateOrder: async () => {
        throw new Error("service unavailable");
      },
    });

    const outcome = await hireAgent({
      client,
      correlator: new OrderEventCorrelator(stream),
      serviceId: "svc-1",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.stage).toBe("negotiate");
  });

  it("times out (does not hang) if order_created never arrives, and records a structured failure", async () => {
    const { stream } = fakeStream();
    const client = fakeClient();

    const outcome = await hireAgent({
      client,
      correlator: new OrderEventCorrelator(stream),
      serviceId: "svc-1",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
      timeouts: { orderCreatedMs: 40 },
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.stage).toBe("await_order_created");
      expect(outcome.reason).toMatch(/Timed out/);
    }
  }, 2000);

  it("fails at the pay stage, carrying orderId, without fabricating a tx", async () => {
    const { stream, fire } = fakeStream();
    const correlator = new OrderEventCorrelator(stream);
    const client = fakeClient({
      negotiateOrder: async () => ({ negotiationId: "neg-1" }),
      payOrder: async () => {
        throw new Error("insufficient balance");
      },
    });

    const outcomePromise = hireAgent({
      client,
      correlator,
      serviceId: "svc-1",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
      timeouts: { orderCreatedMs: 1000 },
    });

    await tick();
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });

    const outcome = await outcomePromise;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.stage).toBe("pay");
      expect(outcome.orderId).toBe("order-1");
      expect(outcome.reason).toContain("insufficient balance");
    }
  });

  it("times out waiting for order_completed after a successful pay, without fabricating a delivery", async () => {
    const { stream, fire } = fakeStream();
    const correlator = new OrderEventCorrelator(stream);
    const client = fakeClient({
      negotiateOrder: async () => ({ negotiationId: "neg-1" }),
    });

    const outcomePromise = hireAgent({
      client,
      correlator,
      serviceId: "svc-1",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
      timeouts: { orderCreatedMs: 1000, orderCompletedMs: 40 },
    });

    await tick();
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });

    const outcome = await outcomePromise;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.stage).toBe("await_order_completed");
      expect(outcome.orderId).toBe("order-1");
    }
  }, 2000);
});

describe("hireAgent — price guard (SDK_NOTES.md items 22-23: real VERIS quote was 200x list price)", () => {
  it("REFUSES to pay when the quoted feeAmount exceeds maxCostUsdc — payOrder is never called", async () => {
    const { stream, fire } = fakeStream();
    const correlator = new OrderEventCorrelator(stream);

    let payCalled = false;
    const client = fakeClient({
      negotiateOrder: async () => ({ negotiationId: "neg-1" }),
      // the real incident's shape: price $20, feeAmount $20 (list price was $0.10)
      getOrder: async () => ({ status: "created", price: "20000000", feeAmount: "20000000" }),
      payOrder: async () => {
        payCalled = true;
        return { txHash: "0xSHOULD_NEVER_HAPPEN", order: { price: "20000000" } };
      },
    });

    const outcomePromise = hireAgent({
      client,
      correlator,
      serviceId: "svc-veris",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
      maxCostUsdc: 0.5,
      timeouts: { orderCreatedMs: 1000 },
    });

    await tick();
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });

    const outcome = await outcomePromise;
    expect(payCalled).toBe(false);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.stage).toBe("price_guard_refused");
      expect(outcome.orderId).toBe("order-1");
      expect(outcome.reason).toContain("$20.00");
      expect(outcome.reason).toContain("$0.50");
      expect(outcome.reason).toContain("nothing charged");
    }
  });

  it("guards on feeAmount, not price: a high nominal price with a normal fee still pays (the successful real VERIS order's shape)", async () => {
    const { stream, fire } = fakeStream();
    const correlator = new OrderEventCorrelator(stream);

    let payCalled = false;
    const client = fakeClient({
      negotiateOrder: async () => ({ negotiationId: "neg-1" }),
      // the PRIOR successful order's shape: price $20 nominal, feeAmount $0.10 actual
      getOrder: async () => ({ status: "created", price: "20000000", feeAmount: "100000" }),
      payOrder: async () => {
        payCalled = true;
        return { txHash: "0xREALTX", order: { price: "20000000" } };
      },
      getDelivery: async (orderId) => fakeDelivery({ orderId }),
    });

    const outcomePromise = hireAgent({
      client,
      correlator,
      serviceId: "svc-veris",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
      maxCostUsdc: 0.5,
      timeouts: { orderCreatedMs: 1000, orderCompletedMs: 1000 },
    });

    await tick();
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });
    await tick();
    fire("order_completed", { type: "order_completed", raw: {}, order_id: "order-1" });

    const outcome = await outcomePromise;
    expect(payCalled).toBe(true);
    expect(outcome.ok).toBe(true);
  });

  it("falls back to price when feeAmount is absent, and pays a normal quote (Repo Doctor's shape)", async () => {
    const { stream, fire } = fakeStream();
    const correlator = new OrderEventCorrelator(stream);

    const client = fakeClient({
      negotiateOrder: async () => ({ negotiationId: "neg-1" }),
      getOrder: async () => ({ status: "created", price: "10000" }), // $0.01, no feeAmount
      getDelivery: async (orderId) => fakeDelivery({ orderId }),
    });

    const outcomePromise = hireAgent({
      client,
      correlator,
      serviceId: "svc-rd",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
      maxCostUsdc: 0.05,
      timeouts: { orderCreatedMs: 1000, orderCompletedMs: 1000 },
    });

    await tick();
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });
    await tick();
    fire("order_completed", { type: "order_completed", raw: {}, order_id: "order-1" });

    const outcome = await outcomePromise;
    expect(outcome.ok).toBe(true);
  });

  it("no guard when maxCostUsdc is undefined (simulate/test paths unchanged)", async () => {
    const { stream, fire } = fakeStream();
    const correlator = new OrderEventCorrelator(stream);

    const client = fakeClient({
      negotiateOrder: async () => ({ negotiationId: "neg-1" }),
      getOrder: async () => ({ status: "created", price: "20000000", feeAmount: "20000000" }),
      getDelivery: async (orderId) => fakeDelivery({ orderId }),
    });

    const outcomePromise = hireAgent({
      client,
      correlator,
      serviceId: "svc-1",
      requirements: {},
      parseDeliverable: parseHealthy,
      simulate: false,
      timeouts: { orderCreatedMs: 1000, orderCompletedMs: 1000 },
    });

    await tick();
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });
    await tick();
    fire("order_completed", { type: "order_completed", raw: {}, order_id: "order-1" });

    const outcome = await outcomePromise;
    expect(outcome.ok).toBe(true);
  });
});
