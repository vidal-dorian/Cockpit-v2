import { App } from "@octokit/app";
import { Octokit } from "@octokit/core";
import { z } from "zod";
import type { ReadInstance } from "./instance.ts";

export type GitHubAppConfig = {
  githubAppId: string;
  githubAppSlug: string;
  /** The PEM text, already decoded from the base64 of the environment (decision 011 H). */
  githubAppPrivateKey: string;
};

const PAGE_SIZE = 100;
// shortcut: 1000 repos at most, a user with more only sees the first ones; raise it if it ever matters.
const MAX_PAGES = 10;
// Shorter than Cloudflare's ~100 s limit, so a slow GitHub ends on our 502, not a 524 (as in auth.ts).
const GITHUB_TIMEOUT_MS = 10_000;

// Looks the global fetch up at call time, so a test's stub still applies.
const TimedOctokit = Octokit.defaults({
  request: {
    fetch: (url: string, init?: RequestInit) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) }),
  },
});

// What we read of GitHub's answers; anything else is ignored.
const installation = z.object({
  id: z.number().int(),
  account: z.object({ id: z.number().int() }),
});
// A file as the Contents API serves it (GitHub follows a symlink to a file of the repo); any other object counts as absent.
const contentsSchema = z.union([
  z.object({ type: z.literal("file"), content: z.string() }),
  z.object({ type: z.string() }).transform(() => null),
]);
// The entries of a Git tree: only "blob" entries (files, symlinks included) count.
const treeSchema = z.object({
  tree: z.array(z.object({ path: z.string(), type: z.string() })),
});
const repoSchema = z.object({
  id: z.number().int(),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
});

/** What the health check (decision 013) reads of a repo's default branch. */
export type RepoFiles = {
  claudeMd: boolean;
  /** Names of the files directly in .github/workflows. */
  workflows: string[];
  /** The text of .mcp.json, null when absent. */
  mcpJson: string | null;
  /** Names of the files directly in .claude/agents. */
  agents: string[];
  /** Names of the files directly in .claude/skills/dev-us. */
  devUsSkill: string[];
};

const isNotFound = (error: unknown) =>
  (error as { status?: number }).status === 404;

/** Reads GitHub with the identity of the App only, never a user's token (decision 011). Errors are left to the caller. */
export function githubClient(config: GitHubAppConfig) {
  const app = new App({
    Octokit: TimedOctokit,
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
  });

  return {
    /** The installation of this personal account, or null when the App is not installed or the account is someone else's. */
    async findUserInstallation(login: string, githubId: number) {
      try {
        const { data } = await app.octokit.request(
          "GET /users/{username}/installation",
          { username: login },
        );
        const found = installation.parse(data);
        // A login can change hands; the account id cannot.
        return found.account.id === githubId ? found.id : null;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    /** Every repo the installation can see (the user chose them on GitHub). */
    async listInstallationRepos(installationId: number) {
      const octokit = await app.getInstallationOctokit(installationId);
      const repos: unknown[] = [];
      // Paged by hand: Octokit's paginate reads the response URL, which a stubbed fetch does not set.
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data } = await octokit.request(
          "GET /installation/repositories",
          { per_page: PAGE_SIZE, page },
        );
        repos.push(...data.repositories);
        if (data.repositories.length < PAGE_SIZE) break;
      }
      return z.array(repoSchema).parse(repos);
    },

    /** The files the health check looks at, on the default branch: one call for the whole Git tree, plus one for .mcp.json when it is there. Null when the tree answers 404 (the App lost access to the repo). */
    async readRepoFiles(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      let blobs: string[] = [];
      try {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
          { owner, repo, tree_sha: "HEAD", recursive: "1" },
        );
        // shortcut: GitHub cuts a tree past ~100,000 entries (`truncated`), so lines may be wrongly red on such a repo; read the directories one by one if one shows up.
        blobs = treeSchema
          .parse(data)
          .tree.filter((entry) => entry.type === "blob")
          .map((entry) => entry.path);
      } catch (error) {
        if (isNotFound(error)) return null;
        // 409: an empty repository, which simply holds none of the files.
        if ((error as { status?: number }).status !== 409) throw error;
      }
      const filesIn = (dir: string) =>
        blobs
          .filter(
            (p) => p.startsWith(`${dir}/`) && !p.includes("/", dir.length + 1),
          )
          .map((p) => p.slice(dir.length + 1));
      let mcpJson: string | null = null;
      if (blobs.includes(".mcp.json")) {
        try {
          const { data } = await octokit.request(
            "GET /repos/{owner}/{repo}/contents/{path}",
            { owner, repo, path: ".mcp.json" },
          );
          const file = contentsSchema.parse(data);
          if (file)
            mcpJson = Buffer.from(file.content, "base64").toString("utf8");
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }
      const files: RepoFiles = {
        claudeMd:
          blobs.includes("CLAUDE.md") || blobs.includes(".claude/CLAUDE.md"),
        workflows: filesIn(".github/workflows"),
        mcpJson,
        agents: filesIn(".claude/agents"),
        devUsSkill: filesIn(".claude/skills/dev-us"),
      };
      return files;
    },
  };
}

/** The client, the App's install page and the instance's public URL, built once the wizard has run (null before): the settings never change after that, so the client keeps its installation tokens. */
export function githubReader(readInstance: ReadInstance) {
  let ready:
    | {
        github: ReturnType<typeof githubClient>;
        installUrl: string;
        publicUrl: string;
      }
    | undefined;
  return async () => {
    if (ready) return ready;
    const settings = await readInstance();
    if (!settings) return null;
    ready = {
      github: githubClient({
        githubAppId: settings.githubAppId,
        githubAppSlug: settings.githubAppSlug,
        githubAppPrivateKey: settings.githubPrivateKey,
      }),
      installUrl: `https://github.com/apps/${settings.githubAppSlug}/installations/new`,
      publicUrl: settings.publicUrl,
    };
    return ready;
  };
}

export type ReadGitHub = ReturnType<typeof githubReader>;
