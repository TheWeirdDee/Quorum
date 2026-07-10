function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RaceEventAndPollParams<T> {
  /** An already-started promise (e.g. correlator.waitForOrderCreated(...)) — its own internal timeout is allowed to fire; that rejection is ignored, not fatal on its own. */
  event: Promise<T>;
  /** Polled every pollIntervalMs until it returns a defined value or the deadline passes. Errors are swallowed and retried. */
  poll: () => Promise<T | undefined>;
  timeoutMs: number;
  pollIntervalMs: number;
  timeoutMessage: string;
}

export interface PollUntilParams<T> {
  poll: () => Promise<T | undefined>;
  timeoutMs: number;
  pollIntervalMs: number;
  timeoutMessage: string;
}

/** Pure polling, no event source — a thin wrapper over raceEventAndPoll with a never-resolving event. */
export function pollUntil<T>(params: PollUntilParams<T>): Promise<T> {
  return raceEventAndPoll({ ...params, event: new Promise<T>(() => undefined) });
}

/**
 * Resolves as soon as EITHER the event arrives OR polling finds the same
 * result, whichever comes first; rejects only if both are exhausted by the
 * deadline. Exists because WebSocket order_created/order_completed delivery
 * to the requester was confirmed unreliable against a real counterparty
 * (SDK_NOTES.md item 16) — the order was verifiably created within seconds
 * both times, but the event either never arrived or arrived too late/on the
 * wrong connection. Event-driven stays the fast path; polling is the safety
 * net, not the primary mechanism.
 */
export async function raceEventAndPoll<T>(params: RaceEventAndPollParams<T>): Promise<T> {
  const { event, poll, timeoutMs, pollIntervalMs, timeoutMessage } = params;
  const deadline = Date.now() + timeoutMs;
  let settled = false;

  return new Promise<T>((resolve, reject) => {
    event
      .then((value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      })
      .catch(() => {
        // The event side failing/timing out isn't fatal by itself — the poll loop below decides overall success or failure.
      });

    (async () => {
      // Poll immediately once before the first sleep — an already-ready
      // resource shouldn't have to wait out a full poll interval to be seen.
      try {
        const found = await poll();
        if (found !== undefined && !settled) {
          settled = true;
          resolve(found);
          return;
        }
      } catch {
        // Transient poll error — fall into the retry loop below.
      }

      while (!settled) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(pollIntervalMs, remaining));
        if (settled) return;
        try {
          const found = await poll();
          if (found !== undefined && !settled) {
            settled = true;
            resolve(found);
            return;
          }
        } catch {
          // Transient poll error — keep trying until the deadline.
        }
      }
      if (!settled) {
        settled = true;
        reject(new Error(timeoutMessage));
      }
    })();
  });
}
