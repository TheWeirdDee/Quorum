import { EventType, type Event, type EventStream } from "@croo-network/sdk";

interface PendingResolver {
  resolve: (event: Event) => void;
}

/**
 * Correlates inbound `order_created` / `order_completed` WebSocket events
 * back to the specific outbound hire waiting on them (SDK_NOTES.md item 2:
 * negotiateOrder returns no orderId — we only learn it from order_created).
 * One correlator per EventStream; construct once and share it across every
 * hireAgent() call on that connection. The same map + socket carries
 * provider-side events in milestone 5 — this class only handles the
 * requester-side pair for now.
 */
export class OrderEventCorrelator {
  private readonly byNegotiationId = new Map<string, PendingResolver>();
  private readonly byOrderId = new Map<string, PendingResolver>();
  /**
   * Events that arrived with no registered waiter yet. CONFIRMED live
   * (SDK_NOTES.md item 15): Repo Doctor's backend can accept a negotiation
   * and fire order_created within milliseconds — faster than the gap
   * between negotiateOrder() resolving and hireAgent() calling
   * waitForOrderCreated(). Without this buffer that event is silently
   * dropped and the caller times out even though the order exists.
   */
  private readonly earlyOrderCreated = new Map<string, Event>();
  private readonly earlyOrderCompleted = new Map<string, Event>();

  constructor(stream: EventStream) {
    stream.on(EventType.OrderCreated, (event) => {
      const negotiationId = event.negotiation_id;
      if (!negotiationId) return;
      const pending = this.byNegotiationId.get(negotiationId);
      if (pending) {
        this.byNegotiationId.delete(negotiationId);
        pending.resolve(event);
        return;
      }
      this.earlyOrderCreated.set(negotiationId, event);
    });

    stream.on(EventType.OrderCompleted, (event) => {
      const orderId = event.order_id;
      if (!orderId) return;
      const pending = this.byOrderId.get(orderId);
      if (pending) {
        this.byOrderId.delete(orderId);
        pending.resolve(event);
        return;
      }
      this.earlyOrderCompleted.set(orderId, event);
    });
  }

  /** Resolves with the order_created event once it arrives, or rejects on timeout. Checks the early-arrival buffer first. */
  waitForOrderCreated(negotiationId: string, timeoutMs: number): Promise<Event> {
    const early = this.earlyOrderCreated.get(negotiationId);
    if (early) {
      this.earlyOrderCreated.delete(negotiationId);
      return Promise.resolve(early);
    }
    return this.wait(this.byNegotiationId, negotiationId, timeoutMs, "order_created");
  }

  /** Resolves with the order_completed event once it arrives, or rejects on timeout. Checks the early-arrival buffer first. */
  waitForOrderCompleted(orderId: string, timeoutMs: number): Promise<Event> {
    const early = this.earlyOrderCompleted.get(orderId);
    if (early) {
      this.earlyOrderCompleted.delete(orderId);
      return Promise.resolve(early);
    }
    return this.wait(this.byOrderId, orderId, timeoutMs, "order_completed");
  }

  private wait(
    registry: Map<string, PendingResolver>,
    key: string,
    timeoutMs: number,
    eventName: string,
  ): Promise<Event> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        registry.delete(key);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${eventName} (key=${key})`));
      }, timeoutMs);

      registry.set(key, {
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
      });
    });
  }

  /** Number of hires currently waiting on an event; exposed for tests and shutdown diagnostics. */
  get pendingCount(): number {
    return this.byNegotiationId.size + this.byOrderId.size;
  }
}
