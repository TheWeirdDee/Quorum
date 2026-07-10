import { describe, expect, it } from "vitest";
import {
  normalizeGithubRepoMeta,
  normalizeNpmPackument,
  normalizeOsvVulnerability,
} from "../../src/detector/normalize.js";
import { trustEventSchema } from "../../src/detector/types.js";
import type { GithubRepoMeta } from "../../src/detector/sources/github.js";
import type { NpmPackument } from "../../src/detector/sources/npmRegistry.js";
import type { OsvVulnerability } from "../../src/detector/sources/osv.js";

describe("normalizeOsvVulnerability", () => {
  it("maps a malware-feed advisory to malicious_release at critical severity", () => {
    const vuln: OsvVulnerability = {
      id: "MAL-2026-0001",
      summary: "Malicious code in evil-dep",
      published: "2026-07-05T10:14:02Z",
    };
    const event = normalizeOsvVulnerability("evil-dep@2.4.1", vuln);
    expect(trustEventSchema.parse(event)).toEqual(event);
    expect(event.type).toBe("malicious_release");
    expect(event.severity_hint).toBe("critical");
    expect(event.ref).toBe("MAL-2026-0001");
    expect(event.source).toBe("osv");
  });

  it("maps a GHSA advisory with a summary mentioning 'malicious' to malicious_release", () => {
    const vuln: OsvVulnerability = {
      id: "GHSA-xxxx-demo-0001",
      summary: "Postinstall script found to be malicious",
      published: "2026-07-05T10:14:02Z",
    };
    const event = normalizeOsvVulnerability("evil-dep@2.4.1", vuln);
    expect(event.type).toBe("malicious_release");
  });

  it("maps a plain CVE advisory to new_cve with mapped severity", () => {
    const vuln: OsvVulnerability = {
      id: "CVE-2026-DEMO-7788",
      summary: "Prototype pollution",
      published: "2026-07-05T09:02:00Z",
      database_specific: { severity: "HIGH" },
    };
    const event = normalizeOsvVulnerability("abandoned-lib@0.9.2", vuln);
    expect(event.type).toBe("new_cve");
    expect(event.severity_hint).toBe("high");
    expect(event.ref).toBe("CVE-2026-DEMO-7788");
  });

  it("defaults to medium severity when OSV provides no severity", () => {
    const vuln: OsvVulnerability = { id: "GHSA-none", published: "2026-01-01T00:00:00Z" };
    const event = normalizeOsvVulnerability("some-pkg@1.0.0", vuln);
    expect(event.severity_hint).toBe("medium");
  });
});

describe("normalizeNpmPackument", () => {
  it("emits a deprecation event for a deprecated latest version", () => {
    const packument: NpmPackument = {
      name: "left-pad",
      "dist-tags": { latest: "1.3.1" },
      time: { "1.3.1": "2026-07-05T10:11:20Z" },
      versions: { "1.3.1": { deprecated: "docs-only patch, use core String.prototype.padStart" } },
      maintainers: [{ name: "stringops" }],
    };
    const events = normalizeNpmPackument("left-pad", packument);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("deprecation");
    expect(events[0]?.dependency).toBe("left-pad@1.3.1");
    expect(events[0]?.severity_hint).toBe("low");
  });

  it("emits no events when nothing changed and no prior maintainer snapshot is given", () => {
    const packument: NpmPackument = {
      name: "left-pad",
      "dist-tags": { latest: "1.3.1" },
      versions: { "1.3.1": {} },
      maintainers: [{ name: "stringops" }],
    };
    expect(normalizeNpmPackument("left-pad", packument)).toHaveLength(0);
  });

  it("emits maintainer_change when the maintainer set differs from the prior snapshot", () => {
    const packument: NpmPackument = {
      name: "evil-dep",
      "dist-tags": { latest: "2.4.1" },
      versions: { "2.4.1": {} },
      maintainers: [{ name: "acme" }, { name: "new-owner" }],
    };
    const events = normalizeNpmPackument("evil-dep", packument, ["acme"]);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("maintainer_change");
    expect(events[0]?.dependency).toBe("evil-dep@2.4.1");
  });

  it("does not emit maintainer_change when the set is unchanged (order-independent)", () => {
    const packument: NpmPackument = {
      name: "evil-dep",
      "dist-tags": { latest: "2.4.1" },
      versions: { "2.4.1": {} },
      maintainers: [{ name: "bob" }, { name: "alice" }],
    };
    const events = normalizeNpmPackument("evil-dep", packument, ["alice", "bob"]);
    expect(events).toHaveLength(0);
  });
});

describe("normalizeGithubRepoMeta", () => {
  const repoUrl = "https://github.com/ghost/abandoned-lib";

  it("emits repo_archived when the repo is archived", () => {
    const meta: GithubRepoMeta = {
      archived: true,
      license: null,
      pushed_at: new Date().toISOString(),
      default_branch: "main",
      owner: { login: "ghost" },
    };
    const events = normalizeGithubRepoMeta("abandoned-lib@0.9.2", repoUrl, meta);
    expect(events.some((e) => e.type === "repo_archived")).toBe(true);
  });

  it("emits license_change with restrictive=true for a known restrictive license", () => {
    const meta: GithubRepoMeta = {
      archived: false,
      license: { spdx_id: "AGPL-3.0" },
      pushed_at: new Date().toISOString(),
      default_branch: "main",
      owner: { login: "acme" },
    };
    const events = normalizeGithubRepoMeta("evil-dep@2.4.1", repoUrl, meta, { license: "MIT" });
    const licenseEvent = events.find((e) => e.type === "license_change");
    expect(licenseEvent).toBeDefined();
    expect(licenseEvent?.context?.restrictive).toBe(true);
    expect(licenseEvent?.severity_hint).toBe("high");
  });

  it("emits abandonment when the last push is older than the threshold", () => {
    const staleDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const meta: GithubRepoMeta = {
      archived: false,
      license: null,
      pushed_at: staleDate,
      default_branch: "main",
      owner: { login: "ghost" },
    };
    const events = normalizeGithubRepoMeta("abandoned-lib@0.9.2", repoUrl, meta);
    expect(events.some((e) => e.type === "abandonment")).toBe(true);
  });

  it("emits nothing for an active, unarchived, license-unchanged repo", () => {
    const meta: GithubRepoMeta = {
      archived: false,
      license: { spdx_id: "MIT" },
      pushed_at: new Date().toISOString(),
      default_branch: "main",
      owner: { login: "acme" },
    };
    const events = normalizeGithubRepoMeta("evil-dep@2.4.1", repoUrl, meta, { license: "MIT" });
    expect(events).toHaveLength(0);
  });
});
