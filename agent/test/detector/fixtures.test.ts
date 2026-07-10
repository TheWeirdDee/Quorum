import { describe, expect, it } from "vitest";
import { loadFixtureEvents } from "../../src/detector/index.js";
import { trustEventSchema } from "../../src/detector/types.js";

describe("loadFixtureEvents", () => {
  it("loads all three seeded events and validates them against the TrustEvent schema", () => {
    const events = loadFixtureEvents();
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(() => trustEventSchema.parse(event)).not.toThrow();
    }
  });

  it("loads the primary demo trigger: evil-dep malicious_release, critical, from osv", () => {
    const events = loadFixtureEvents();
    const malicious = events.find((e) => e.type === "malicious_release");
    expect(malicious).toBeDefined();
    expect(malicious?.dependency).toBe("evil-dep@2.4.1");
    expect(malicious?.severity_hint).toBe("critical");
    expect(malicious?.source).toBe("osv");
    expect(malicious?.ref).toBe("GHSA-xxxx-demo-0001");
  });

  it("loads the contrast event: left-pad deprecation, low severity", () => {
    const events = loadFixtureEvents();
    const patch = events.find((e) => e.type === "deprecation");
    expect(patch).toBeDefined();
    expect(patch?.dependency).toBe("left-pad@1.3.1");
    expect(patch?.severity_hint).toBe("low");
  });

  it("loads the agreement-path event: abandoned-lib new_cve, high severity", () => {
    const events = loadFixtureEvents();
    const cve = events.find((e) => e.type === "new_cve");
    expect(cve).toBeDefined();
    expect(cve?.dependency).toBe("abandoned-lib@0.9.2");
    expect(cve?.severity_hint).toBe("high");
    expect(cve?.ref).toBe("CVE-2026-DEMO-7788");
  });
});
