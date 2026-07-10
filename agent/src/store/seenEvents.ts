import type Database from "better-sqlite3";
import type { TrustEvent } from "../detector/types.js";

/** True if this (dependency, type, ref) triple has already fired the pipeline. */
export function hasSeen(db: Database.Database, event: Pick<TrustEvent, "dependency" | "type" | "ref">): boolean {
  const row = db
    .prepare(`SELECT 1 FROM seen_events WHERE dependency = ? AND type = ? AND ref = ?`)
    .get(event.dependency, event.type, event.ref);
  return row !== undefined;
}

/** The seen_events row id for this (dependency, type, ref) triple, so a decision can be linked back to it — undefined if it was never recorded (e.g. a synthetic M5 baseline event). */
export function getSeenEventId(db: Database.Database, event: Pick<TrustEvent, "dependency" | "type" | "ref">): number | undefined {
  const row = db
    .prepare(`SELECT id FROM seen_events WHERE dependency = ? AND type = ? AND ref = ?`)
    .get(event.dependency, event.type, event.ref) as { id: number } | undefined;
  return row?.id;
}

/**
 * Records an event as seen. Idempotent: if the (dependency, type, ref) triple
 * is already recorded, this is a no-op (first-seen wins).
 */
export function recordSeen(
  db: Database.Database,
  event: TrustEvent,
  repoId: number | null = null,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO seen_events
      (repo_id, dependency, type, ref, severity_hint, source, observed_at, context_json, first_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    repoId,
    event.dependency,
    event.type,
    event.ref,
    event.severity_hint,
    event.source,
    event.observed_at,
    event.context ? JSON.stringify(event.context) : null,
    new Date().toISOString(),
  );
}

/**
 * Filters a batch of events down to the ones not yet seen, and records them
 * as seen in the same pass. Events are processed in order; duplicates within
 * the same batch are also collapsed.
 */
export function admitNewEvents(
  db: Database.Database,
  events: readonly TrustEvent[],
  repoId: number | null = null,
): TrustEvent[] {
  const admitted: TrustEvent[] = [];
  for (const event of events) {
    if (hasSeen(db, event)) continue;
    recordSeen(db, event, repoId);
    admitted.push(event);
  }
  return admitted;
}
