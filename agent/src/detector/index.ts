import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { logger } from "../config/logger.js";
import { admitNewEvents } from "../store/seenEvents.js";
import {
  normalizeGithubRepoMeta,
  normalizeNpmPackument,
  normalizeOsvVulnerability,
} from "./normalize.js";
import { fetchRepoMeta, resolveNpmDependencies } from "./sources/github.js";
import { fetchNpmPackument } from "./sources/npmRegistry.js";
import { queryOsv } from "./sources/osv.js";
import { trustEventSchema, type TrustEvent } from "./types.js";

export interface PollDependencyInput {
  name: string;
  version: string;
  /** The dependency's own GitHub repo, if already resolved (see npm→GitHub resolver, milestone 3). */
  repoUrl?: string;
  previousMaintainers?: readonly string[];
  previousLicense?: string;
}

/** Polls OSV + npm registry (+ GitHub, if repoUrl is known) for one dependency and normalizes the results. */
export async function detectTrustEvents(dep: PollDependencyInput): Promise<TrustEvent[]> {
  const dependency = `${dep.name}@${dep.version}`;
  const events: TrustEvent[] = [];

  const vulns = await queryOsv(dep.name, dep.version);
  events.push(...vulns.map((vuln) => normalizeOsvVulnerability(dependency, vuln)));

  const packument = await fetchNpmPackument(dep.name);
  if (packument) {
    events.push(...normalizeNpmPackument(dep.name, packument, dep.previousMaintainers));
  }

  if (dep.repoUrl) {
    const meta = await fetchRepoMeta(dep.repoUrl);
    if (meta) {
      events.push(
        ...normalizeGithubRepoMeta(
          dependency,
          dep.repoUrl,
          meta,
          dep.previousLicense ? { license: dep.previousLicense } : undefined,
        ),
      );
    }
  }

  return events;
}

/**
 * Resolves a monitored repo's npm dependencies, polls each one, and admits
 * only the events not already in seen_events (FR-5, FR-6, FR-7). Returns the
 * newly-fired events; already-seen events are silently dropped.
 *
 * `maxDeps` bounds how many dependencies actually get polled this sweep
 * (production dependencies first) — a repo with hundreds of dependencies
 * would otherwise blow past a CAP order's delivery window (M5's baseline
 * scan) or hammer OSV/npm/GitHub every poll-loop cycle. Defaults to
 * unbounded so existing callers/tests are unaffected.
 */
export async function pollRepoForNewEvents(
  db: Database.Database,
  repoId: number,
  repoUrl: string,
  maxDeps: number = Infinity,
): Promise<TrustEvent[]> {
  const deps = await resolveNpmDependencies(repoUrl);
  if (!deps) {
    logger.warn(`No package.json found for ${repoUrl}; nothing to poll`);
    return [];
  }

  const bounded = [...deps].sort((a, b) => Number(b.isProduction) - Number(a.isProduction)).slice(0, maxDeps);
  if (bounded.length < deps.length) {
    logger.warn(
      `${repoUrl}: ${deps.length} dependencies found, polling only the first ${bounded.length} (production-first) this sweep`,
    );
  }

  const allEvents: TrustEvent[] = [];
  for (const dep of bounded) {
    const events = await detectTrustEvents({ name: dep.name, version: dep.version });
    allEvents.push(...events);
  }

  return admitNewEvents(db, allEvents, repoId);
}

const FIXTURES_EVENTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/events",
);

/**
 * Loads and validates the offline TrustEvent fixtures (fixtures/events/*.json)
 * used by USE_FIXTURES mode, the demo harness, and unit tests. Strips the
 * `_note` documentation field fixtures carry that isn't part of the contract.
 */
export function loadFixtureEvents(dir: string = FIXTURES_EVENTS_DIR): TrustEvent[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const raw = JSON.parse(readFileSync(path.join(dir, file), "utf-8")) as Record<string, unknown>;
      const { _note, ...event } = raw;
      void _note;
      return trustEventSchema.parse(event);
    });
}
