import type { AgentClient, EventStream } from "@croo-network/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderEventCorrelator } from "../../src/croo/orderCorrelator.js";
import { baselineHireTimeouts, runBaselineScan } from "../../src/provider/registerRepo.js";
import type { QuorumRequest } from "../../src/provider/requestSchema.js";
import { listDependenciesForRepo } from "../../src/store/dependencies.js";
import { closeDb, openDb, type QuorumDb } from "../../src/store/db.js";
import { getRepoByUrl } from "../../src/store/repos.js";

function fakeStream() {
  return { on: () => undefined } as unknown as EventStream;
}
const fakeClient = {} as AgentClient;

function jsonResponse(body: unknown, ok = true, status = 200): Promise<Response> {
  return Promise.resolve({ ok, status, statusText: ok ? "OK" : "Not Found", json: async () => body } as Response);
}

/** Routes GitHub contents/npm registry/OSV/Slack calls so runBaselineScan needs no real network — the repo has exactly one dependency, "left-pad", with no advisories or maintainer changes, so no event is admitted at all. */
function stubQuietNetwork() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL) => {
      const u = url.toString();
      if (u.includes("/contents/package.json")) {
        const manifest = JSON.stringify({ dependencies: { "left-pad": "1.3.1" } });
        return jsonResponse({ content: Buffer.from(manifest, "utf-8").toString("base64"), encoding: "base64" });
      }
      if (u.includes("registry.npmjs.org")) {
        return jsonResponse({
          name: "left-pad",
          "dist-tags": { latest: "1.3.1" },
          versions: { "1.3.1": {} },
          maintainers: [{ name: "foo" }],
        });
      }
      if (u.includes("api.osv.dev")) {
        return jsonResponse({});
      }
      if (u.includes("hooks.slack.com")) {
        return jsonResponse({ ok: true });
      }
      throw new Error(`registerRepo.test: unexpected fetch to ${u}`);
    }),
  );
}

describe("runBaselineScan", () => {
  let db: QuorumDb;
  let correlator: OrderEventCorrelator;

  beforeEach(async () => {
    db = await openDb(":memory:");
    correlator = new OrderEventCorrelator(fakeStream());
  });

  afterEach(async () => {
    await closeDb(db);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("registers the repo, indexes its npm dependencies, and delivers an honest baseline decision when nothing is investigatable", async () => {
    stubQuietNetwork();
    const request: QuorumRequest = { repo: "https://github.com/acme/monitored", ecosystems: ["npm"], risk_policy: "balanced" };

    const result = await runBaselineScan({ db, client: fakeClient, correlator, request, simulate: true });

    expect(result.dependencyCount).toBe(1);
    expect(result.decision.decision).toBe("ARCHIVED_NO_ACTION");
    expect(result.decision.event.type).toBe("baseline_scan");
    expect(result.decision.event.source).toBe("system");

    const stored = await getRepoByUrl(db, "https://github.com/acme/monitored");
    expect(stored?.risk_policy).toBe("balanced");
    const deps = await listDependenciesForRepo(db, result.repo.id);
    expect(deps.map((d) => d.name)).toEqual(["left-pad"]);
  });

  it("stores the buyer's budget_cap_usdc override and explicit notify webhook", async () => {
    stubQuietNetwork();
    const request: QuorumRequest = {
      repo: "https://github.com/acme/monitored2",
      ecosystems: ["npm"],
      risk_policy: "enterprise",
      budget_cap_usdc: 0.5,
      notify: { type: "slack", webhook: "https://hooks.slack.com/services/X" },
    };

    const result = await runBaselineScan({ db, client: fakeClient, correlator, request, simulate: true });

    expect(result.repo.budget_cap_usdc).toBe(0.5);
    expect(result.repo.notify_webhook).toBe("https://hooks.slack.com/services/X");
  });

  it("respects an explicit notify:none — never falls back to the env demo webhook", async () => {
    stubQuietNetwork();
    const request: QuorumRequest = {
      repo: "https://github.com/acme/monitored3",
      ecosystems: ["npm"],
      risk_policy: "startup",
      notify: { type: "none" },
    };

    const result = await runBaselineScan({ db, client: fakeClient, correlator, request, simulate: true });

    expect(result.repo.notify_type).toBe("none");
    expect(result.repo.notify_webhook).toBeNull();
  });

  it("registers with 0 dependencies when the repo has no package.json, still delivering a baseline decision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        const u = url.toString();
        if (u.includes("/contents/package.json")) return jsonResponse({}, false, 404);
        if (u.includes("hooks.slack.com")) return jsonResponse({ ok: true });
        throw new Error(`registerRepo.test: unexpected fetch to ${u}`);
      }),
    );
    const request: QuorumRequest = { repo: "https://github.com/acme/no-manifest", ecosystems: ["npm"], risk_policy: "balanced" };

    const result = await runBaselineScan({ db, client: fakeClient, correlator, request, simulate: true });

    expect(result.dependencyCount).toBe(0);
    expect(result.decision.decision).toBe("ARCHIVED_NO_ACTION");
  });

  it("does not index dependencies when npm is not among the requested ecosystems", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL) => {
        throw new Error(`registerRepo.test: unexpected fetch to ${url} — npm ecosystem was not requested`);
      }),
    );
    const request: QuorumRequest = { repo: "https://github.com/acme/pyonly", ecosystems: ["pypi"], risk_policy: "balanced" };

    const result = await runBaselineScan({ db, client: fakeClient, correlator, request, simulate: true });

    expect(result.dependencyCount).toBe(0);
    expect(result.decision.decision).toBe("ARCHIVED_NO_ACTION");
  });
});

describe("baselineHireTimeouts", () => {
  it("refuses to start autonomous hires when less than 30 seconds remain", () => {
    expect(baselineHireTimeouts(29_999, 0)).toBeUndefined();
  });

  it("bounds all four sequential wait stages inside the remaining SLA window", () => {
    expect(baselineHireTimeouts(8 * 60_000, 0)).toEqual({
      orderCreatedMs: 90_000,
      orderCompletedMs: 120_000,
    });
  });
});
