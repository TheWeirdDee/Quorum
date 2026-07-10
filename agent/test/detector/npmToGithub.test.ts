import { describe, expect, it } from "vitest";
import { normalizeToGithubUrl, resolveGithubRepoUrl } from "../../src/detector/npmToGithub.js";

describe("normalizeToGithubUrl — pure, offline", () => {
  const cases: Array<[string, string | undefined]> = [
    ["git+https://github.com/expressjs/express.git", "https://github.com/expressjs/express"],
    ["git+ssh://git@github.com/stevemao/left-pad.git", "https://github.com/stevemao/left-pad"],
    ["git://github.com/owner/repo.git", "https://github.com/owner/repo"],
    ["git@github.com:owner/repo.git", "https://github.com/owner/repo"],
    ["github:owner/repo", "https://github.com/owner/repo"],
    ["owner/repo", "https://github.com/owner/repo"],
    ["https://github.com/owner/repo", "https://github.com/owner/repo"],
    ["https://github.com/owner/repo.git", "https://github.com/owner/repo"],
    ["https://github.com/owner/repo/", "https://github.com/owner/repo"],
    ["https://gitlab.com/owner/repo.git", undefined],
    ["", undefined],
  ];

  it.each(cases)("%s -> %s", (raw, expected) => {
    expect(normalizeToGithubUrl(raw)).toBe(expected);
  });
});

describe("resolveGithubRepoUrl — live npm registry (FR-10)", () => {
  it(
    "resolves express's scp-less git+https repository field to its GitHub URL",
    async () => {
      const url = await resolveGithubRepoUrl("express");
      expect(url).toBe("https://github.com/expressjs/express");
    },
    20_000,
  );

  it(
    "resolves left-pad's git+ssh repository field to its GitHub URL",
    async () => {
      const url = await resolveGithubRepoUrl("left-pad");
      expect(url).toBe("https://github.com/stevemao/left-pad");
    },
    20_000,
  );

  it(
    "returns undefined for a package that doesn't exist",
    async () => {
      const url = await resolveGithubRepoUrl("this-package-should-not-exist-quorum-test-9f8e7d6c");
      expect(url).toBeUndefined();
    },
    20_000,
  );
});
