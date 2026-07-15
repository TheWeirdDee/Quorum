import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, openDb, type QuorumDb } from "../../src/store/db.js";
import { upsertRepo } from "../../src/store/repos.js";

// vi.mock calls are hoisted above all imports by vitest's transform, so the
// mock functions referenced inside the factory must be created via
// vi.hoisted() to avoid a TDZ reference error at hoist time.
const { pollRepoForNewEventsMock, processEventMock } = vi.hoisted(() => ({
  pollRepoForNewEventsMock: vi.fn(),
  processEventMock: vi.fn(),
}));

vi.mock("../../src/detector/index.js", () => ({ pollRepoForNewEvents: pollRepoForNewEventsMock }));
vi.mock("../../src/orchestrate/processEvent.js", () => ({ processEvent: processEventMock }));

import { pollOnce, startPollLoop } from "../../src/worker/pollLoop.js";

describe("pollOnce", () => {
  let db: QuorumDb;

  beforeEach(async () => {
    db = await openDb(":memory:");
    pollRepoForNewEventsMock.mockReset();
    processEventMock.mockReset();
  });

  afterEach(async () => closeDb(db));

  it("processes every newly-admitted event for every registered repo", async () => {
    const repoA = await upsertRepo(db, { githubUrl: "https://github.com/acme/a", riskPolicy: "balanced" });
    const repoB = await upsertRepo(db, { githubUrl: "https://github.com/acme/b", riskPolicy: "enterprise" });

    const eventA = { dependency: "x@1.0.0", type: "new_cve", severity_hint: "high", source: "osv", ref: "GHSA-a", observed_at: new Date().toISOString() };
    const eventB = { dependency: "y@1.0.0", type: "new_cve", severity_hint: "high", source: "osv", ref: "GHSA-b", observed_at: new Date().toISOString() };
    pollRepoForNewEventsMock.mockImplementation(async (_db: unknown, repoId: number) => (repoId === repoA.id ? [eventA] : [eventB]));
    processEventMock.mockResolvedValue({ ok: true, decision: {} });

    await pollOnce({ db, client: {} as never, correlator: {} as never });

    expect(processEventMock).toHaveBeenCalledTimes(2);
    expect(processEventMock).toHaveBeenCalledWith(expect.objectContaining({ event: eventA, repo: expect.objectContaining({ id: repoA.id }) }));
    expect(processEventMock).toHaveBeenCalledWith(expect.objectContaining({ event: eventB, repo: expect.objectContaining({ id: repoB.id }) }));
  });

  it("logs and continues sweeping other repos when event detection fails for one", async () => {
    await upsertRepo(db, { githubUrl: "https://github.com/acme/broken", riskPolicy: "balanced" });
    await upsertRepo(db, { githubUrl: "https://github.com/acme/ok", riskPolicy: "balanced" });
    pollRepoForNewEventsMock.mockImplementationOnce(async () => {
      throw new Error("OSV down");
    });
    pollRepoForNewEventsMock.mockImplementationOnce(async () => []);

    await expect(pollOnce({ db, client: {} as never, correlator: {} as never })).resolves.toBeUndefined();
    expect(pollRepoForNewEventsMock).toHaveBeenCalledTimes(2);
  });

  it("logs and continues when processEvent throws for one event", async () => {
    await upsertRepo(db, { githubUrl: "https://github.com/acme/c", riskPolicy: "balanced" });
    const event = { dependency: "z@1.0.0", type: "new_cve", severity_hint: "high", source: "osv", ref: "GHSA-c", observed_at: new Date().toISOString() };
    pollRepoForNewEventsMock.mockResolvedValue([event]);
    processEventMock.mockRejectedValue(new Error("hire blew up"));

    await expect(pollOnce({ db, client: {} as never, correlator: {} as never })).resolves.toBeUndefined();
    expect(processEventMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a repo with no newly-admitted events", async () => {
    await upsertRepo(db, { githubUrl: "https://github.com/acme/quiet", riskPolicy: "balanced" });
    pollRepoForNewEventsMock.mockResolvedValue([]);

    await pollOnce({ db, client: {} as never, correlator: {} as never });

    expect(processEventMock).not.toHaveBeenCalled();
  });
});

describe("startPollLoop", () => {
  let db: QuorumDb;

  beforeEach(async () => {
    db = await openDb(":memory:");
    pollRepoForNewEventsMock.mockReset().mockResolvedValue([]);
    processEventMock.mockReset();
  });

  afterEach(async () => closeDb(db));

  it("runs pollOnce on each interval and stop() halts further cycles", async () => {
    vi.useFakeTimers();
    try {
      await upsertRepo(db, { githubUrl: "https://github.com/acme/timer", riskPolicy: "balanced" });

      const { stop } = startPollLoop({ db, client: {} as never, correlator: {} as never }, 1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(pollRepoForNewEventsMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(pollRepoForNewEventsMock).toHaveBeenCalledTimes(2);

      stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(pollRepoForNewEventsMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
