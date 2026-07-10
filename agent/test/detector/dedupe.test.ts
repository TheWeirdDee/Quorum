import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFixtureEvents } from "../../src/detector/index.js";
import type { TrustEvent } from "../../src/detector/types.js";
import { openDb } from "../../src/store/db.js";
import { admitNewEvents, hasSeen, recordSeen } from "../../src/store/seenEvents.js";

describe("seen_events dedupe", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("treats an event as unseen before it is recorded", () => {
    const [event] = loadFixtureEvents();
    expect(event).toBeDefined();
    expect(hasSeen(db, event as TrustEvent)).toBe(false);
  });

  it("treats an event as seen once recorded, keyed by (dependency, type, ref)", () => {
    const [event] = loadFixtureEvents();
    recordSeen(db, event as TrustEvent);
    expect(hasSeen(db, event as TrustEvent)).toBe(true);
  });

  it("does not consider a different ref for the same dependency+type as seen", () => {
    const [event] = loadFixtureEvents();
    recordSeen(db, event as TrustEvent);
    expect(hasSeen(db, { ...(event as TrustEvent), ref: "GHSA-different" })).toBe(false);
  });

  it("admits all three seeded fixture events on first pass", () => {
    const events = loadFixtureEvents();
    const admitted = admitNewEvents(db, events);
    expect(admitted).toHaveLength(3);
  });

  it("admits nothing on a second pass over the same events (fires the pipeline once)", () => {
    const events = loadFixtureEvents();
    admitNewEvents(db, events);
    const secondPass = admitNewEvents(db, events);
    expect(secondPass).toHaveLength(0);
  });

  it("collapses exact duplicates within a single batch", () => {
    const [event] = loadFixtureEvents();
    const admitted = admitNewEvents(db, [event as TrustEvent, event as TrustEvent]);
    expect(admitted).toHaveLength(1);
  });

  it("re-admits the malicious_release event only after a fresh dedupe window (different db)", () => {
    const events = loadFixtureEvents();
    admitNewEvents(db, events);
    const freshDb = openDb(":memory:");
    try {
      expect(admitNewEvents(freshDb, events)).toHaveLength(3);
    } finally {
      freshDb.close();
    }
  });
});
