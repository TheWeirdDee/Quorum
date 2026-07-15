import type { TrustEvent } from "../detector/types.js";
import type { QuorumDb } from "./db.js";

/** True if this (dependency, type, ref) triple has already fired the pipeline. */
export async function hasSeen(db: QuorumDb, event: Pick<TrustEvent, "dependency" | "type" | "ref">): Promise<boolean> {
  const row = await db("seen_events")
    .select("id")
    .where({ dependency: event.dependency, type: event.type, ref: event.ref })
    .first();
  return row !== undefined;
}

/** The seen_events row id for this (dependency, type, ref) triple, so a decision can be linked back to it — undefined if it was never recorded (e.g. a synthetic M5 baseline event). */
export async function getSeenEventId(db: QuorumDb, event: Pick<TrustEvent, "dependency" | "type" | "ref">): Promise<number | undefined> {
  const row = (await db("seen_events")
    .select("id")
    .where({ dependency: event.dependency, type: event.type, ref: event.ref })
    .first()) as { id: number } | undefined;
  return row?.id;
}

/**
 * Records an event as seen. Idempotent: if the (dependency, type, ref) triple
 * is already recorded, this is a no-op (first-seen wins).
 */
export async function recordSeen(
  db: QuorumDb,
  event: TrustEvent,
  repoId: number | null = null,
): Promise<void> {
  await db("seen_events")
    .insert({
      repo_id: repoId,
      dependency: event.dependency,
      type: event.type,
      ref: event.ref,
      severity_hint: event.severity_hint,
      source: event.source,
      observed_at: event.observed_at,
      context_json: event.context ? JSON.stringify(event.context) : null,
      first_seen_at: new Date().toISOString(),
    })
    .onConflict(["dependency", "type", "ref"])
    .ignore();
}

/**
 * Filters a batch of events down to the ones not yet seen, and records them
 * as seen in the same pass. Events are processed in order; duplicates within
 * the same batch are also collapsed.
 */
export async function admitNewEvents(
  db: QuorumDb,
  events: readonly TrustEvent[],
  repoId: number | null = null,
): Promise<TrustEvent[]> {
  const admitted: TrustEvent[] = [];
  for (const event of events) {
    if (await hasSeen(db, event)) continue;
    await recordSeen(db, event, repoId);
    admitted.push(event);
  }
  return admitted;
}
