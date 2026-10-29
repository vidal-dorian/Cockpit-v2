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
// A Git tree. `truncated` is GitHub cutting a recursive answer short.
const treeSchema = z.object({
  sha: z.string(),
  truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string(), type: z.string() })),
});
const repoSchema = z.object({
  id: z.number().int(),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
});

/** What the cache (decision 013) remembers of a repo: the commit (the `sha` GitHub returns for `HEAD`) it was computed from. */
export type KnownRoot = { etag: string; commitSha: string };

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

const ignoreStatus = async (status: number, call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if ((error as { status?: number }).status !== status) throw error;
  }
};

/** Talks to GitHub with the identity of the App only, never a user's token (decision 011). Errors are left to the caller. */
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

    /** The files the health check looks at, on the default branch. Every read is bounded by a small directory, never by the size of the repo: the root listing, `.claude`, `.github/workflows`, and `.mcp.json` when it is there. Null when the root answers 404 (the App lost access to the repo). When the root is the `known` one (GitHub answers 304, or 200 with the same commit sha), nothing else is read and the answer is `unchanged`. */
    async readRepoFiles(
      installationId: number,
      fullName: string,
      known?: KnownRoot,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      // A Git tree (`HEAD` or `<sha>:<dir>`), null when it does not exist. For a directory GitHub answers 422 when the path is a file, a symlink or a submodule, so 422 means absent too.
      // `truncated` is ignored on purpose on the root and the workflows: GitHub's limit is about recursive answers, and 100,000 direct entries in one directory is not realistic.
      const readTree = async (
        treeish: string,
        recursive = false,
        etag?: string,
      ) => {
        try {
          const { data, headers } = await octokit.request(
            "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
            {
              owner,
              repo,
              tree_sha: treeish,
              ...(recursive && { recursive: "1" }),
              ...(etag && { headers: { "if-none-match": etag } }),
            },
          );
          return { ...treeSchema.parse(data), etag: headers.etag };
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (status === 404 || (status === 422 && treeish !== "HEAD"))
            return null;
          throw error;
        }
      };
      // Only blobs count: files and symlinks, not directories or submodules.
      const blobs = (tree: z.infer<typeof treeSchema> | null, prefix: string) =>
        (tree?.tree ?? [])
          .filter((entry) => entry.type === "blob")
          .map((entry) => `${prefix}${entry.path}`);

      let root: Awaited<ReturnType<typeof readTree>>;
      try {
        root = await readTree("HEAD", false, known?.etag);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 304 && known)
          return { unchanged: true as const, etag: known.etag };
        // 409: an empty repository, which simply holds none of the files.
        if (status !== 409) throw error;
        root = { sha: "", truncated: false, tree: [], etag: undefined };
      }
      if (!root) return null;
      // The same commit, whatever the ETag says, means nothing changed.
      if (known && root.sha === known.commitSha)
        return {
          unchanged: true as const,
          etag: root.etag ?? known.etag,
        };
      const rootBlobs = blobs(root, "");
      const rootTrees = root.tree
        .filter((entry) => entry.type === "tree")
        .map((entry) => entry.path);

      // Every other read is pinned to the commit the root answered, so a push in between cannot mix two states.
      const at = (dir: string) => `${root.sha}:${dir}`;
      const readClaude = async () => {
        const whole = await readTree(at(".claude"), true);
        if (!whole?.truncated) return blobs(whole, ".claude/");
        // A huge .claude: GitHub cut the answer, so read the three directories we need one by one.
        const parts = await Promise.all([
          readTree(at(".claude")).then((t) => blobs(t, ".claude/")),
          readTree(at(".claude/agents")).then((t) =>
            blobs(t, ".claude/agents/"),
          ),
          readTree(at(".claude/skills/dev-us")).then((t) =>
            blobs(t, ".claude/skills/dev-us/"),
          ),
        ]);
        return parts.flat();
      };
      const readMcpJson = async () => {
        try {
          const { data } = await octokit.request(
            "GET /repos/{owner}/{repo}/contents/{path}",
            { owner, repo, path: ".mcp.json", ref: root.sha },
          );
          const file = contentsSchema.parse(data);
          return file && Buffer.from(file.content, "base64").toString("utf8");
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      };
      const [claude, workflows, mcpJson] = await Promise.all([
        rootTrees.includes(".claude") ? readClaude() : [],
        rootTrees.includes(".github")
          ? readTree(at(".github/workflows")).then((t) =>
              blobs(t, ".github/workflows/"),
            )
          : [],
        rootBlobs.includes(".mcp.json") ? readMcpJson() : null,
      ]);
      const paths = [...rootBlobs, ...claude, ...workflows];
      const filesIn = (dir: string) =>
        paths
          .filter(
            (p) => p.startsWith(`${dir}/`) && !p.includes("/", dir.length + 1),
          )
          .map((p) => p.slice(dir.length + 1));
      const files: RepoFiles = {
        claudeMd:
          paths.includes("CLAUDE.md") || paths.includes(".claude/CLAUDE.md"),
        workflows: filesIn(".github/workflows"),
        mcpJson,
        agents: filesIn(".claude/agents"),
        devUsSkill: filesIn(".claude/skills/dev-us"),
      };
      return {
        unchanged: false as const,
        files,
        commitSha: root.sha,
        etag: root.etag,
      };
    },

    /** The text of CLAUDE.md at the root of the default branch, "" when there is none (or the repo is empty), null when the root answers 404 (the App lost access to the repo). Like the health check, the file is read at the commit the root listing answered, so the two reads cannot mix two states. Errors are left to the caller. */
    async readClaudeMd(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      let root: z.infer<typeof treeSchema>;
      try {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
          { owner, repo, tree_sha: "HEAD" },
        );
        root = treeSchema.parse(data);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404) return null;
        // 409: an empty repository, which holds no file.
        if (status === 409) return "";
        throw error;
      }
      if (!root.tree.some((e) => e.path === "CLAUDE.md" && e.type === "blob"))
        return "";
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        { owner, repo, path: "CLAUDE.md", ref: root.sha },
      );
      const file = contentsSchema.parse(data);
      return file ? Buffer.from(file.content, "base64").toString("utf8") : "";
    },

    /** Writes the issues of a repo and the one label Cockpit puts on them (decision 020), as the installation. */
    async issues(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      return {
        /** Creates the issue, with its label already on it (the label must exist), and returns its number. */
        async create(issue: { title: string; body: string; label: string }) {
          const { data } = await octokit.request(
            "POST /repos/{owner}/{repo}/issues",
            {
              owner,
              repo,
              title: issue.title,
              body: issue.body,
              labels: [issue.label],
            },
          );
          return z.object({ number: z.number().int() }).parse(data).number;
        },
        update: (
          number: number,
          issue: {
            title: string;
            body: string;
            state: "open" | "closed";
            stateReason: "completed" | "not_planned" | null;
          },
        ) =>
          octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
            owner,
            repo,
            issue_number: number,
            title: issue.title,
            body: issue.body,
            state: issue.state,
            // GitHub reopens with no reason; sending null would be refused.
            ...(issue.stateReason && { state_reason: issue.stateReason }),
          }),
        /** 422 is "already exists". */
        ensureLabel: (name: string) =>
          ignoreStatus(
            422,
            octokit.request("POST /repos/{owner}/{repo}/labels", {
              owner,
              repo,
              name,
            }),
          ),
        addLabel: (number: number, name: string) =>
          octokit.request(
            "POST /repos/{owner}/{repo}/issues/{issue_number}/labels",
            { owner, repo, issue_number: number, labels: [name] },
          ),
        /** 404 is "the issue does not carry it". */
        removeLabel: (number: number, name: string) =>
          ignoreStatus(
            404,
            octokit.request(
              "DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}",
              { owner, repo, issue_number: number, name },
            ),
          ),
      };
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
