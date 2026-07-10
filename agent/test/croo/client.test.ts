import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/config/logger.js";
import { createCrooClient } from "../../src/croo/client.js";

describe("createCrooClient", () => {
  it("throws without an API key", () => {
    expect(() => createCrooClient({ apiKey: "" })).toThrow(/CROO_API_KEY/);
  });

  it("constructs successfully with an explicit key, without touching the network", () => {
    const client = createCrooClient({ apiKey: "croo_sk_test_construct_only" });
    expect(client).toBeDefined();
  });
});

describe("redacting logger — SDK-Key never reaches log output", () => {
  const FAKE_KEY = "croo_sk_test_leak_check_9f8e7d6c";
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env["CROO_API_KEY"] = FAKE_KEY;
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    delete process.env["CROO_API_KEY"];
  });

  it("scrubs the key when embedded inside a URL — reproduces the SDK's own 'websocket connecting' log call (SDK_NOTES.md item 9)", () => {
    // dist/ws.js: url.searchParams.set('key', this.sdkKey); this.logger.info('websocket connecting', { url: url.toString() });
    const leakyUrl = `wss://api.croo.network/ws?key=${FAKE_KEY}`;
    logger.info("websocket connecting", { url: leakyUrl });

    const output = infoSpy.mock.calls.map((call) => JSON.stringify(call)).join("\n");
    expect(output).not.toContain(FAKE_KEY);
    expect(output).toContain("[REDACTED]");
  });

  it("scrubs a bare key argument too", () => {
    logger.info("some sdk debug line", FAKE_KEY);
    const output = infoSpy.mock.calls.map((call) => JSON.stringify(call)).join("\n");
    expect(output).not.toContain(FAKE_KEY);
  });

  it("scrubs the key inside a nested error stack", () => {
    const err = new Error(`request failed for wss://api.croo.network/ws?key=${FAKE_KEY}`);
    logger.info("connection error", err);
    const output = infoSpy.mock.calls.map((call) => JSON.stringify(call)).join("\n");
    expect(output).not.toContain(FAKE_KEY);
  });
});
