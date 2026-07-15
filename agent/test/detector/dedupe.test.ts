import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixtureEvents } from "../../src/detector/index.js";
import type { TrustEvent } from "../../src/detector/types.js";
import { closeDb, openDb, type QuorumDb } from "../../src/store/db.js";
import { admitNewEvents, hasSeen, recordSeen } from "../../src/store/seenEvents.js";

describe("seen_events dedupe", () => {
  let db: QuorumDb;

  beforeEach(async () => {
    db = await openDb(":memory:");
  });

  afterEach(async () => {
    await closeDb(db);
  });

  it("treats an event as unseen before it is recorded", async () => {
    const [event] = loadFixtureEvents();
    expect(event).toBeDefined();
    expect(await hasSeen(db, event as TrustEvent)).toBe(false);
  });

  it("treats an event as seen once recorded, keyed by (dependency, type, ref)", async () => {
    const [event] = loadFixtureEvents();
    await recordSeen(db, event as TrustEvent);
    expect(await hasSeen(db, event as TrustEvent)).toBe(true);
  });

  it("does not consider a different ref for the same dependency+type as seen", async () => {
    const [event] = loadFixtureEvents();
    await recordSeen(db, event as TrustEvent);
    expect(await hasSeen(db, { ...(event as TrustEvent), ref: "GHSA-different" })).toBe(false);
  });

  it("admits all three seeded fixture events on first pass", async () => {
    const events = loadFixtureEvents();
    const admitted = await admitNewEvents(db, events);
    expect(admitted).toHaveLength(3);
  });

  it("admits nothing on a second pass over the same events (fires the pipeline once)", async () => {
    const events = loadFixtureEvents();
    await admitNewEvents(db, events);
    const secondPass = await admitNewEvents(db, events);
    expect(secondPass).toHaveLength(0);
  });

  it("collapses exact duplicates within a single batch", async () => {
    const [event] = loadFixtureEvents();
    const admitted = await admitNewEvents(db, [event as TrustEvent, event as TrustEvent]);
    expect(admitted).toHaveLength(1);
  });

  it("re-admits the malicious_release event only after a fresh dedupe window (different db)", async () => {
    const events = loadFixtureEvents();
    await admitNewEvents(db, events);
    const freshDb = await openDb(":memory:");
    try {
      expect(await admitNewEvents(freshDb, events)).toHaveLength(3);
    } finally {
      await closeDb(freshDb);
    }
  });
});
