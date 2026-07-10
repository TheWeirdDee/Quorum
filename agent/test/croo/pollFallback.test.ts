import { describe, expect, it } from "vitest";
import { raceEventAndPoll } from "../../src/croo/pollFallback.js";

function never<T>(): Promise<T> {
  return new Promise(() => undefined);
}

describe("raceEventAndPoll", () => {
  it("resolves from the event immediately when it wins", async () => {
    const result = await raceEventAndPoll({
      event: Promise.resolve("from-event"),
      poll: async () => "from-poll",
      timeoutMs: 1000,
      pollIntervalMs: 500,
      timeoutMessage: "should not time out",
    });
    expect(result).toBe("from-event");
  });

  it("rescues a result via polling when the event never arrives (the confirmed live failure mode)", async () => {
    let calls = 0;
    const result = await raceEventAndPoll({
      event: never<string>(),
      poll: async () => {
        calls += 1;
        return calls >= 2 ? "found-by-poll" : undefined;
      },
      timeoutMs: 2000,
      pollIntervalMs: 20,
      timeoutMessage: "should not time out",
    });
    expect(result).toBe("found-by-poll");
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("ignores transient poll errors and keeps retrying until it succeeds", async () => {
    let calls = 0;
    const result = await raceEventAndPoll({
      event: never<string>(),
      poll: async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient network error");
        return "found-after-errors";
      },
      timeoutMs: 2000,
      pollIntervalMs: 15,
      timeoutMessage: "should not time out",
    });
    expect(result).toBe("found-after-errors");
  });

  it("rejects with the timeout message when both event and poll are exhausted", async () => {
    await expect(
      raceEventAndPoll({
        event: never<string>(),
        poll: async () => undefined,
        timeoutMs: 60,
        pollIntervalMs: 20,
        timeoutMessage: "custom timeout message",
      }),
    ).rejects.toThrow("custom timeout message");
  });

  it("an event-side rejection alone is not fatal — poll can still win", async () => {
    const result = await raceEventAndPoll({
      event: Promise.reject(new Error("event timed out internally")),
      poll: async () => "rescued",
      timeoutMs: 1000,
      pollIntervalMs: 10,
      timeoutMessage: "should not time out",
    });
    expect(result).toBe("rescued");
  });
});
