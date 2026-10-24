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
// A file or a directory listing, as the Contents API serves them; any other object (submodule, symlink…) counts as absent.
const contentsSchema = z.union([
  z.object({ type: z.literal("file"), content: z.string() }),
  z.array(z.object({ name: z.string(), type: z.string() })),
  z.object({ type: z.string() }).transform(() => null),
]);
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

    /** The files the health check looks at, on the default branch; null when the repo itself answers 404 (the App lost access to it). */
    async readRepoFiles(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      try {
        await octokit.request("GET /repos/{owner}/{repo}", { owner, repo });
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      // A file, a directory listing, or null when the path does not exist.
      const read = async (path: string) => {
        try {
          const { data } = await octokit.request(
            "GET /repos/{owner}/{repo}/contents/{path}",
            { owner, repo, path },
          );
          return contentsSchema.parse(data);
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      };
      const isFile = (found: Awaited<ReturnType<typeof read>>) =>
        found !== null && !Array.isArray(found);
      const fileNames = (found: Awaited<ReturnType<typeof read>>) =>
        Array.isArray(found)
          ? found.filter((e) => e.type === "file").map((e) => e.name)
          : [];
      const [rootClaudeMd, dotClaudeMd, workflows, mcp, agents, devUsSkill] =
        await Promise.all([
          read("CLAUDE.md"),
          read(".claude/CLAUDE.md"),
          read(".github/workflows"),
          read(".mcp.json"),
          read(".claude/agents"),
          read(".claude/skills/dev-us"),
        ]);
      const files: RepoFiles = {
        claudeMd: isFile(rootClaudeMd) || isFile(dotClaudeMd),
        workflows: fileNames(workflows),
        mcpJson:
          mcp && !Array.isArray(mcp)
            ? Buffer.from(mcp.content, "base64").toString("utf8")
            : null,
        agents: fileNames(agents),
        devUsSkill: fileNames(devUsSkill),
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
