import { describe, expect, it } from "vitest";
import { parseQuorumRequest } from "../../src/provider/requestSchema.js";

describe("parseQuorumRequest — Agent Store wire format (the shape that rejected two real orders)", () => {
  it("accepts the EXACT payload the store's order form sends: notify as a JSON string, ecosystems as a string, empty optionals", () => {
    const raw = JSON.stringify({
      repo: "https://github.com/TheWeirdDee/Quorum",
      ecosystems: "",
      risk_policy: "startup",
      budget_cap_usdc: 0.05,
      notify: '{"type":"none"}',
    });

    const result = parseQuorumRequest(raw);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.repo).toBe("https://github.com/TheWeirdDee/Quorum");
      expect(result.request.ecosystems).toEqual(["npm"]); // "" -> omitted -> default
      expect(result.request.risk_policy).toBe("startup");
      expect(result.request.budget_cap_usdc).toBe(0.05);
      expect(result.request.notify).toEqual({ type: "none" });
    }
  });

  it("splits a comma-separated ecosystems string into the array the schema expects", () => {
    const result = parseQuorumRequest(
      JSON.stringify({ repo: "https://github.com/acme/thing", ecosystems: "npm, pypi", risk_policy: "balanced" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.ecosystems).toEqual(["npm", "pypi"]);
  });

  it("coerces a stringified budget_cap_usdc number", () => {
    const result = parseQuorumRequest(
      JSON.stringify({ repo: "https://github.com/acme/thing", risk_policy: "enterprise", budget_cap_usdc: "0.25" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.budget_cap_usdc).toBe(0.25);
  });

  it("still parses the canonical object form (schemas/quorum.request.schema.json) unchanged", () => {
    const result = parseQuorumRequest(
      JSON.stringify({
        repo: "https://github.com/acme/thing",
        ecosystems: ["npm"],
        risk_policy: "enterprise",
        budget_cap_usdc: 0.25,
        notify: { type: "slack", webhook: "https://hooks.slack.com/services/X" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.notify).toEqual({ type: "slack", webhook: "https://hooks.slack.com/services/X" });
  });

  it("still rejects genuinely malformed input with a field-level reason (never silently coerces garbage)", () => {
    const result = parseQuorumRequest(
      JSON.stringify({ repo: "not-a-github-url", risk_policy: "yolo", notify: "not json at all" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("invalid quorum.register request");
      expect(result.reason).toContain("repo");
      expect(result.reason).toContain("risk_policy");
    }
  });
});
