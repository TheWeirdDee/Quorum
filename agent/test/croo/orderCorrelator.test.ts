import type { Event, EventStream, EventTypeName } from "@croo-network/sdk";
import { describe, expect, it } from "vitest";
import { OrderEventCorrelator } from "../../src/croo/orderCorrelator.js";

/** Minimal fake EventStream: records handlers by event type, lets tests fire them manually. */
function fakeEventStream() {
  const handlers = new Map<string, (event: Event) => void>();
  const stream = {
    on: (eventType: EventTypeName | string, handler: (event: Event) => void) => {
      handlers.set(eventType, handler);
    },
  } as unknown as EventStream;

  return {
    stream,
    fire(eventType: string, event: Event) {
      handlers.get(eventType)?.(event);
    },
  };
}

describe("OrderEventCorrelator", () => {
  it("resolves waitForOrderCreated when order_created fires for the matching negotiation", async () => {
    const { stream, fire } = fakeEventStream();
    const correlator = new OrderEventCorrelator(stream);

    const pending = correlator.waitForOrderCreated("neg-1", 1000);
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });

    const event = await pending;
    expect(event.order_id).toBe("order-1");
  });

  it("ignores order_created events for a different negotiation", async () => {
    const { stream, fire } = fakeEventStream();
    const correlator = new OrderEventCorrelator(stream);

    const pending = correlator.waitForOrderCreated("neg-1", 200);
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-OTHER", order_id: "order-x" });

    await expect(pending).rejects.toThrow(/Timed out/);
  });

  it("resolves waitForOrderCompleted when order_completed fires for the matching order", async () => {
    const { stream, fire } = fakeEventStream();
    const correlator = new OrderEventCorrelator(stream);

    const pending = correlator.waitForOrderCompleted("order-1", 1000);
    fire("order_completed", { type: "order_completed", raw: {}, order_id: "order-1" });

    const event = await pending;
    expect(event.order_id).toBe("order-1");
  });

  it("rejects with a timeout error if no matching event arrives in time", async () => {
    const { stream } = fakeEventStream();
    const correlator = new OrderEventCorrelator(stream);

    await expect(correlator.waitForOrderCreated("neg-never", 50)).rejects.toThrow(/Timed out after 50ms/);
  });

  it("correlates multiple concurrent waits independently", async () => {
    const { stream, fire } = fakeEventStream();
    const correlator = new OrderEventCorrelator(stream);

    const a = correlator.waitForOrderCreated("neg-a", 1000);
    const b = correlator.waitForOrderCreated("neg-b", 1000);

    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-b", order_id: "order-b" });
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-a", order_id: "order-a" });

    expect((await a).order_id).toBe("order-a");
    expect((await b).order_id).toBe("order-b");
  });

  it("cleans up pending waiters after resolution (pendingCount returns to 0)", async () => {
    const { stream, fire } = fakeEventStream();
    const correlator = new OrderEventCorrelator(stream);

    const pending = correlator.waitForOrderCreated("neg-1", 1000);
    expect(correlator.pendingCount).toBe(1);
    fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });
    await pending;
    expect(correlator.pendingCount).toBe(0);
  });

  it("cleans up pending waiters after a timeout too", async () => {
    const { stream } = fakeEventStream();
    const correlator = new OrderEventCorrelator(stream);

    const pending = correlator.waitForOrderCreated("neg-1", 30);
    expect(correlator.pendingCount).toBe(1);
    await expect(pending).rejects.toThrow();
    expect(correlator.pendingCount).toBe(0);
  });

  describe("early-arrival race (SDK_NOTES.md item 15 — confirmed live against Repo Doctor)", () => {
    it("does not drop order_created if it fires before waitForOrderCreated is called", async () => {
      const { stream, fire } = fakeEventStream();
      const correlator = new OrderEventCorrelator(stream);

      // Event arrives first — nobody registered a waiter yet.
      fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });

      // The wait call comes after. Must resolve immediately from the buffer, not time out.
      const event = await correlator.waitForOrderCreated("neg-1", 50);
      expect(event.order_id).toBe("order-1");
    });

    it("does not drop order_completed if it fires before waitForOrderCompleted is called", async () => {
      const { stream, fire } = fakeEventStream();
      const correlator = new OrderEventCorrelator(stream);

      fire("order_completed", { type: "order_completed", raw: {}, order_id: "order-1" });

      const event = await correlator.waitForOrderCompleted("order-1", 50);
      expect(event.order_id).toBe("order-1");
    });

    it("consumes a buffered early event exactly once — a second wait for the same key times out", async () => {
      const { stream, fire } = fakeEventStream();
      const correlator = new OrderEventCorrelator(stream);

      fire("order_created", { type: "order_created", raw: {}, negotiation_id: "neg-1", order_id: "order-1" });
      await correlator.waitForOrderCreated("neg-1", 50);

      await expect(correlator.waitForOrderCreated("neg-1", 30)).rejects.toThrow(/Timed out/);
    });
  });
});
