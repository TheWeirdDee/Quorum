import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSlackMessage, notifySlack } from "../../src/notify/slack.js";
import type { QuorumDecision } from "../../src/decision/schema.js";

const baseDecision: QuorumDecision = {
  schema: "quorum.decision.v1",
  dependency: "evil-dep@2.4.1",
  event: { type: "malicious_release", detail: "compromised release", source: "osv", ref: "GHSA-xxxx", severity_hint: "critical" },
  gate: { investigated: true, reason: "critical severity on a production dependency" },
  decision: "DO_NOT_SHIP",
  confidence: 0.94,
  lenses: {
    health: { agent: "Repo Doctor", verdict: "healthy", order_id: "o1", tx: "0xaaa", cost_usdc: 0.01 },
    trust: { agent: "VERIS", verdict: "high_risk", order_id: "o2", tx: "0xbbb", cost_usdc: 0.1 },
  },
  escalation: { triggered: true, agent: "Themis", order_id: "o3", tx: "0xccc", cost_usdc: 0.03, reason: "confidence 0.60 < target 0.90" },
  disagreement: "Repo Doctor sees an active repo; VERIS flags high risk.",
  total_spend_usdc: 0.14,
  receipts: ["0xaaa", "0xbbb", "0xccc"],
  decided_at: "2026-07-05T10:14:32Z",
};

describe("formatSlackMessage", () => {
  it("includes the decision, confidence, both lenses, disagreement, and escalation", () => {
    const text = formatSlackMessage(baseDecision);
    expect(text).toContain("DO_NOT_SHIP");
    expect(text).toContain("evil-dep@2.4.1");
    expect(text).toContain("94%");
    expect(text).toContain("Repo Doctor");
    expect(text).toContain("VERIS");
    expect(text).toContain("Disagreement:");
    expect(text).toContain("Themis");
    expect(text).toContain("$0.14");
  });

  it("omits lens/disagreement/escalation lines for an archived decision", () => {
    const archived: QuorumDecision = {
      ...baseDecision,
      decision: "ARCHIVED_NO_ACTION",
      confidence: 1,
      lenses: {},
      escalation: { triggered: false },
      disagreement: "",
      total_spend_usdc: 0,
      receipts: [],
    };
    const text = formatSlackMessage(archived);
    expect(text).toContain("ARCHIVED_NO_ACTION");
    expect(text).not.toContain("Disagreement:");
    expect(text).not.toContain("Escalation:");
  });
});

describe("notifySlack", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the formatted message to the webhook and returns true on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await notifySlack(baseDecision, "https://hooks.slack.com/services/T/B/X");

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/T/B/X");
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toContain("DO_NOT_SHIP");
  });

  it("returns false without calling fetch when no webhook is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const ok = await notifySlack(baseDecision, "");

    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false (never throws) when the webhook responds with an error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" }));
    const ok = await notifySlack(baseDecision, "https://hooks.slack.com/services/T/B/X");
    expect(ok).toBe(false);
  });

  it("returns false (never throws) when fetch itself rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const ok = await notifySlack(baseDecision, "https://hooks.slack.com/services/T/B/X");
    expect(ok).toBe(false);
  });
});
