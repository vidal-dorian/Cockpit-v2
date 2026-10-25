import { afterEach, describe, expect, it, vi } from "vitest";
import { githubClient } from "./github.ts";
import { githubAppConfig, INSTALLATION_ID, stubGitHub } from "./test-github.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const repo = (id: number) => ({
  id,
  full_name: `octocat/repo${id}`,
  default_branch: "main",
});

describe("listInstallationRepos", () => {
  it("given 101 repos over two pages, when they are listed, then every repo comes back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(
          typeof input === "string" ? input : (input as Request).url,
        );
        if (url.pathname.endsWith("/access_tokens"))
          return Response.json(
            {
              token: "ghs_x",
              expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            },
            { status: 201 },
          );
        const page = Number(url.searchParams.get("page"));
        const ids =
          page === 1 ? Array.from({ length: 100 }, (_, i) => i + 1) : [101];
        return Response.json({ total_count: 101, repositories: ids.map(repo) });
      }),
    );

    const repos = await githubClient(githubAppConfig).listInstallationRepos(77);

    expect(repos.map((r) => r.id)).toEqual(
      Array.from({ length: 101 }, (_, i) => i + 1),
    );
  });
});

describe("readClaudeMd", () => {
  it.each([
    ["a repository without commit", { emptyRepo: true }, ""],
    ["a repository the App can no longer reach", { treesStatus: 404 }, null],
    ["a repository holding only a README", { files: { "README.md": "x" } }, ""],
    [
      "a CLAUDE.md at the root",
      { files: { "CLAUDE.md": "# Rules" } },
      "# Rules",
    ],
    [
      "a CLAUDE.md only in a subdirectory",
      { files: { "docs/CLAUDE.md": "# Not the root" } },
      "",
    ],
  ])(
    "given %s, when CLAUDE.md is read, then its text or an empty string",
    async (_name, options, expected) => {
      stubGitHub({ account: 1, ...options });

      const text = await githubClient(githubAppConfig).readClaudeMd(
        INSTALLATION_ID,
        "octocat/app",
      );

      expect(text).toBe(expected);
    },
  );
});
