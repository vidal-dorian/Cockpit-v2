import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/core";
import { z } from "zod";
import type { ReadInstance } from "./instance.ts";
import { AGENT_NAME, MAX_TEAM_NAME } from "./team.ts";

type GitHubAppConfig = {
  githubAppId: string;
  githubAppSlug: string;
  /** The PEM text, already decoded from the base64 of the environment (decision 011 H). */
  githubAppPrivateKey: string;
};

const PAGE_SIZE = 100;
// shortcut: 1000 repos at most, a user with more only sees the first ones; raise it if it ever matters.
const MAX_PAGES = 10;
const PULL_FILES_MAX_PAGES = 30;
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
  z.object({
    type: z.literal("file"),
    content: z.string(),
    // "none": a file too large for Contents, whose content is then "".
    encoding: z.string(),
  }),
  z.object({ type: z.string() }).transform(() => null),
]);
// A Git tree. `truncated` is GitHub cutting a recursive answer short.
const treeSchema = z.object({
  sha: z.string(),
  truncated: z.boolean(),
  tree: z.array(
    z.object({ path: z.string(), mode: z.string(), type: z.string() }),
  ),
});
const shaSchema = z.object({ sha: z.string() });
const refSchema = z.object({ object: shaSchema });
const pullRequestSchema = z.object({
  number: z.number().int(),
  html_url: z.string(),
});
// What link_pull_request checks of a PR: its head branch and where it comes from (decision 035 C).
const pullHeadSchema = z.object({
  head: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
});
// What the follow of a PR reads (decision 038 B).
const pullStateSchema = z.object({
  state: z.string(),
  merged: z.boolean(),
  head: z.object({ sha: z.string() }),
});
const checkRunsSchema = z.object({
  check_runs: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
    }),
  ),
});
const reviewsSchema = z.array(
  z.object({
    user: z.object({ login: z.string() }).nullable(),
    state: z.string(),
  }),
);
const pullFilesSchema = z.array(
  z.object({ filename: z.string(), previous_filename: z.string().optional() }),
);
const CHANGELOG_PULL_PAGES = 3;
const mergedPullsSchema = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    merged_at: z.string().nullable(),
    head: z.object({ sha: z.string() }),
  }),
);
const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    name: z.string().nullable(),
    draft: z.boolean(),
    published_at: z.string().nullable(),
  }),
);
const branchesSchema = z.array(
  z.object({
    name: z.string(),
    protected: z.boolean(),
    commit: z.object({ sha: z.string() }),
  }),
);
// What the CI / CD tab reads of the Actions API (decision 067 B).
const workflowsSchema = z.object({
  workflows: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      path: z.string(),
      state: z.string(),
    }),
  ),
});
const workflowRunsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      conclusion: z.string().nullable(),
      event: z.string(),
      created_at: z.string(),
      run_started_at: z.string().nullable().optional(),
      updated_at: z.string(),
      html_url: z.string(),
    }),
  ),
});
const repoSchema = z.object({
  id: z.number().int(),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
  // Decision 068 B: « Template repository » in the repo's settings.
  is_template: z.boolean().default(false),
});

/** What we read of the App's webhook (decision 024 F); `active` is only there if GitHub sends it. */
const hookConfigSchema = z.object({
  url: z.string(),
  active: z.boolean().optional(),
});
const hookDeliveriesSchema = z.array(z.object({ status_code: z.number() }));
const permissionsSchema = z.record(z.string(), z.string()).default({});
const appAccessSchema = z.object({
  permissions: permissionsSchema,
  events: z.array(z.string()).default([]),
});
const installationAccessSchema = z.object({
  html_url: z.string(),
  permissions: permissionsSchema,
});

// Decision 052 D: what is read of an alert of GitHub, named field by field. zod drops the rest, so the `secret` of a secret scanning alert never goes any further.
// `state` is absent from a secret scanning webhook and null for a code scanning alert of a pull request: the webhook handler judges it itself.
const alertBase = { number: z.number().int(), state: z.string().nullish() };
export const dependabotAlert = z.object({
  ...alertBase,
  dependency: z.object({ manifest_path: z.string().optional() }),
  security_advisory: z.object({
    ghsa_id: z.string(),
    cve_id: z.string().nullish(),
    summary: z.string(),
    severity: z.string(),
  }),
  security_vulnerability: z.object({
    package: z.object({ ecosystem: z.string(), name: z.string() }),
    vulnerable_version_range: z.string().nullish(),
    first_patched_version: z.object({ identifier: z.string() }).nullish(),
  }),
});
export const codeScanningAlert = z.object({
  ...alertBase,
  rule: z.object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    severity: z.string().nullish(),
    security_severity_level: z.string().nullish(),
    description: z.string().nullish(),
  }),
  tool: z.object({ name: z.string().nullish() }).nullish(),
  most_recent_instance: z
    .object({
      ref: z.string().nullish(),
      commit_sha: z.string().nullish(),
      message: z.object({ text: z.string().nullish() }).nullish(),
      location: z
        .object({
          path: z.string().nullish(),
          start_line: z.number().int().nullish(),
          end_line: z.number().int().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});
export const secretScanningAlert = z.object({
  ...alertBase,
  secret_type: z.string(),
  secret_type_display_name: z.string().nullish(),
});
export const ALERT_TOOLS = {
  dependabot: { path: "dependabot", schema: dependabotAlert },
  code_scanning: { path: "code-scanning", schema: codeScanningAlert },
  secret_scanning: { path: "secret-scanning", schema: secretScanningAlert },
} as const;
export type AlertTool = keyof typeof ALERT_TOOLS;
const locationsSchema = z.array(
  z.object({
    type: z.string(),
    details: z.record(z.string(), z.unknown()).default({}),
  }),
);
const commitLocationSchema = z.object({
  path: z.string(),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  commit_sha: z.string(),
});
const MAX_ALERT_PAGES = 10;

/** What the cache (decision 013) remembers of a repo: the commit (the `sha` GitHub returns for `HEAD`) it was computed from. */
type KnownRoot = { etag: string; commitSha: string };

/** What the health check (decision 013) reads of a repo's default branch. */
export type RepoFiles = {
  claudeMd: boolean;
  /** Names of the files directly in .github/workflows. */
  workflows: string[];
  /** The text of .mcp.json, null when absent. */
  mcpJson: string | null;
  /** The text of .claude/team.md (decision 029), null when absent. */
  teamMd: string | null;
  /** The texts of the named teams `.claude/teams/<name>.md` (decision 032), "" for one that cannot be read. */
  teams: string[];
  /** Names of the files directly in .claude/agents. */
  agents: string[];
  /** Names of the files directly in .claude/skills/dev-us. */
  devUsSkill: string[];
  /** Names of the files directly at the root (decision 052 L). */
  rootFiles: string[];
  /** Names of the files directly in .github, not in its sub-folders (decision 052 L). */
  githubFiles: string[];
};

const isNotFound = (error: unknown) =>
  (error as { status?: number }).status === 404;

// Decision 026 D: what a plan to write may hold.
const MAX_WRITE_FILES = 50;
const MAX_WRITE_BYTES = 1_048_576;
const MAX_PATH_LENGTH = 255;

/** A file to add to a repo (decision 026). */
export type WriteFile = { path: string; content: string };
/** What `planRepoWrite` says of one file (a file given with `unlessExists`, a list of paths, is left out when any of them is there, decision 027 B): `exists` is never written, `current` is then the text in the repo; `update` is an old original copy (decision 049 G), replaced, `current` being its text. */
type RepoWritePlan = {
  baseSha: string;
  /** Proves the plan comes from `planRepoWrite` of this client and was not touched (decision 026 H). */
  signature?: string;
  files: (WriteFile & {
    status: "create" | "same" | "exists" | "update";
    current?: string;
  })[];
};
/** Why a write is refused (decision 026 C, E and G); refusals are returned, not thrown. */
type RepoWriteRefusal = {
  refused:
    | "empty_repo"
    | "repo_unreachable"
    | "repo_changed"
    | "pull_request_forbidden"
    | "workflows_forbidden";
};

/** GitHub refusing to write a workflow because the App lacks `workflows` (decision 067 D), whatever the status. */
const noWorkflowsPermission = (error: unknown) =>
  /without `workflows` permission/i.test(
    (error as { message?: string }).message ?? "",
  );

/** An invalid plan is a programming error (the files come from Cockpit's catalogue), so it throws. */
export function checkWriteFiles(files: WriteFile[]) {
  if (files.length > MAX_WRITE_FILES)
    throw new Error(`At most ${MAX_WRITE_FILES} files per write`);
  const paths = new Set<string>();
  let bytes = 0;
  for (const { path, content } of files) {
    const segments = path.split("/");
    if (
      path.length > MAX_PATH_LENGTH ||
      /\p{Cc}/u.test(path) ||
      segments.some(
        (s) =>
          s === "" || s === "." || s === ".." || s.toLowerCase() === ".git",
      )
    )
      throw new Error(`Invalid path ${JSON.stringify(path)}`);
    if (paths.has(path)) throw new Error(`Path given twice: ${path}`);
    paths.add(path);
    bytes += Buffer.byteLength(content);
  }
  // One tree cannot hold a file and a directory of the same name.
  for (const path of paths)
    if ([...paths].some((other) => other.startsWith(`${path}/`)))
      throw new Error(`Path is also a directory: ${path}`);
  if (bytes > MAX_WRITE_BYTES)
    throw new Error(`At most ${MAX_WRITE_BYTES} bytes per write`);
}

/** The labels of an issue as GitHub answers them, reduced to their names. */
const labelsSchema = z
  .array(z.object({ name: z.string() }))
  .transform((labels) => labels.map((label) => label.name));

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

  // Drawn with the client, so a plan signed before a restart is not trusted (decision 026 H). `current` is left out: it is only shown, never written.
  const signingKey = randomBytes(32);
  const sign = ({ baseSha, files }: Omit<RepoWritePlan, "signature">) =>
    createHmac("sha256", signingKey)
      .update(
        JSON.stringify([
          baseSha,
          files.map((f) => [f.path, f.status, f.content]),
        ]),
      )
      .digest("hex");
  const isSigned = (plan: RepoWritePlan) => {
    const expected = Buffer.from(sign(plan));
    const given = Buffer.from(
      typeof plan.signature === "string" ? plan.signature : "",
    );
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  /** What reading and writing one repo needs (decision 026), as the installation. */
  const writeAccess = async (installationId: number, fullName: string) => {
    const [owner, name] = fullName.split("/") as [string, string];
    const octokit = await app.getInstallationOctokit(installationId);
    // Each directory tree is read once per call, the reads in flight being shared by all the files (decision 026 H).
    const trees = new Map<string, Promise<z.infer<typeof treeSchema>>>();
    return {
      octokit,
      owner,
      name,
      /** The default branch and the commit it points to; a refusal when the repo is out of reach (404) or has no commit (409). */
      async head(): Promise<
        { branch: string; sha: string } | RepoWriteRefusal
      > {
        try {
          const { data } = await octokit.request("GET /repos/{owner}/{repo}", {
            owner,
            repo: name,
          });
          const branch = repoSchema.parse(data).default_branch;
          const ref = await octokit.request(
            // The branch is in the URL itself, each segment encoded, as for its update below: a {ref} would encode the slashes.
            `GET /repos/{owner}/{repo}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
            { owner, repo: name },
          );
          return { branch, sha: refSchema.parse(ref.data).object.sha };
        } catch (error) {
          if (isNotFound(error))
            return { refused: "repo_unreachable" as const };
          if ((error as { status?: number }).status === 409)
            return { refused: "empty_repo" as const };
          throw error;
        }
      },
      /** What is at a path of a commit: null when absent (`create`), `{ text }` for a regular file (mode 100644 or 100755) that can be read, `{}` for anything else, which must not be written over: a directory, a symlink, a submodule, a file too large to read, or a path under a parent that is not a real directory. Walks down from the root through entries of type `tree` only, so what GitHub answers for a submodule's path (404, 422 or even 200) never matters. */
      async inspect(path: string, sha: string) {
        const segments = path.split("/");
        // A directory that its parent lists as a tree (the root being the commit itself): any other answer is GitHub lagging behind or changing under us, never an empty place to write into.
        const readDir = (dir: string) => {
          const treeish = dir ? `${sha}:${dir}` : sha;
          let read = trees.get(treeish);
          if (!read) {
            read = octokit
              .request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
                owner,
                repo: name,
                tree_sha: treeish,
              })
              .then(({ data }) => treeSchema.parse(data));
            trees.set(treeish, read);
          }
          return read;
        };
        let tree = await readDir("");
        for (let depth = 0; ; depth++) {
          const entry = tree.tree.find((e) => e.path === segments[depth]);
          if (!entry) {
            // A truncated listing could hide the entry: never take it for absent.
            if (tree.truncated)
              throw new Error(
                `Truncated tree at ${segments.slice(0, depth).join("/") || "/"}`,
              );
            return null;
          }
          if (depth < segments.length - 1) {
            if (entry.type !== "tree") return {};
            tree = await readDir(segments.slice(0, depth + 1).join("/"));
            continue;
          }
          if (entry.type !== "blob" || !/^100(644|755)$/.test(entry.mode))
            return {};
          const { data } = await octokit.request(
            // The path is in the URL itself, each segment encoded: a {path} would encode the slashes.
            `GET /repos/{owner}/{repo}/contents/${segments.map(encodeURIComponent).join("/")}`,
            { owner, repo: name, ref: sha },
          );
          const file = Array.isArray(data) ? null : contentsSchema.parse(data);
          if (!file || file.encoding === "none") return {};
          return { text: Buffer.from(file.content, "base64").toString("utf8") };
        }
      },
    };
  };

  /** The entries of a directory of a commit that have this type, [] when there is none (404, or 422 for a file). */
  const entriesOf = async (
    repo: Awaited<ReturnType<typeof writeAccess>>,
    sha: string,
    dir: string,
    type: "blob" | "tree",
  ) => {
    try {
      const { data } = await repo.octokit.request(
        "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
        { owner: repo.owner, repo: repo.name, tree_sha: `${sha}:${dir}` },
      );
      return treeSchema.parse(data).tree.filter((e) => e.type === type);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 404 || status === 422) return [];
      throw error;
    }
  };
  const mdNames = (entries: { path: string }[], max: number) =>
    entries
      .filter((e) => e.path.endsWith(".md"))
      .map((e) => e.path.slice(0, -".md".length))
      .filter((name) => name.length <= max && AGENT_NAME.test(name))
      .sort();

  /** The files `<mdDir>/<name>.md` and the skills `<skillsDir>/<name>/SKILL.md` of a commit, by name, a text that cannot be read being "" (decisions 065 A, 066 D). */
  const readNamed = async (
    repo: Awaited<ReturnType<typeof writeAccess>>,
    sha: string,
    mdDir: string,
    skillsDir: string,
  ) => {
    // null only for no file.
    const read = async (path: string) => {
      const found = await repo.inspect(path, sha);
      return found === null ? null : (found.text ?? "");
    };
    const names = mdNames(await entriesOf(repo, sha, mdDir, "blob"), Infinity);
    const dirs = (await entriesOf(repo, sha, skillsDir, "tree"))
      .map((e) => e.path)
      .filter((name) => AGENT_NAME.test(name))
      .sort();
    return {
      files: await Promise.all(
        names.map(async (name) => ({
          name,
          text: (await read(`${mdDir}/${name}.md`)) ?? "",
        })),
      ),
      // A directory without SKILL.md is not a skill.
      skills: (
        await Promise.all(
          dirs.map(async (name) => ({
            name,
            text: await read(`${skillsDir}/${name}/SKILL.md`),
          })),
        )
      ).flatMap(({ name, text }) => (text === null ? [] : [{ name, text }])),
    };
  };

  /** Commits `entries` on top of `head` and advances the default branch without force, once; when it is protected, the commit goes to a branch `cockpit/<7>` and a pull request listing `paths` is opened (decision 026 G). Shared by `applyRepoWrite` and `applyRepoChanges`. */
  const commitToHead = async (
    { octokit, owner, name }: Awaited<ReturnType<typeof writeAccess>>,
    head: { branch: string; sha: string },
    entries: {
      path: string;
      mode: "100644";
      type: "blob";
      content?: string;
      sha?: null;
    }[],
    message: string,
  ): Promise<
    | { commitSha: string; pullRequest?: { number: number; url: string } }
    | RepoWriteRefusal
  > => {
    const paths = entries.map((entry) => entry.path);
    const { data: base } = await octokit.request(
      "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
      { owner, repo: name, commit_sha: head.sha },
    );
    const { data: tree } = await octokit.request(
      "POST /repos/{owner}/{repo}/git/trees",
      {
        owner,
        repo: name,
        base_tree: shaSchema.parse(base.tree).sha,
        tree: entries,
      },
    );
    const { data: commit } = await octokit.request(
      "POST /repos/{owner}/{repo}/git/commits",
      {
        owner,
        repo: name,
        message,
        tree: shaSchema.parse(tree).sha,
        parents: [head.sha],
      },
    );
    const commitSha = shaSchema.parse(commit).sha;
    try {
      await octokit.request(
        // The branch is in the URL itself, each segment encoded: a {ref} would encode its slashes, and a raw `#` or `{` would change the URL.
        `PATCH /repos/{owner}/{repo}/git/refs/heads/${head.branch.split("/").map(encodeURIComponent).join("/")}`,
        { owner, repo: name, sha: commitSha, force: false },
      );
    } catch (error) {
      const { status, message: reason } = error as {
        status?: number;
        message: string;
      };
      // The App lacks `workflows` and the commit touches .github/workflows (decision 067 D): a pull request would be refused the same way.
      if (noWorkflowsPermission(error))
        return { refused: "workflows_forbidden" };
      // Both the texts of a protected branch and of a ruleset; 403 or 422 depending on the rule (decision 026 G).
      if (
        (status === 403 || status === 422) &&
        /protected branch|rule violation/i.test(reason)
      ) {
        const branch = `cockpit/${commitSha.slice(0, 7)}`;
        try {
          await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
            owner,
            repo: name,
            ref: `refs/heads/${branch}`,
            sha: commitSha,
          });
        } catch (refError) {
          if (noWorkflowsPermission(refError))
            return { refused: "workflows_forbidden" };
          throw refError;
        }
        let data: unknown;
        try {
          ({ data } = await octokit.request(
            "POST /repos/{owner}/{repo}/pulls",
            {
              owner,
              repo: name,
              head: branch,
              base: head.branch,
              title: message,
              body: `${paths.map((path) => `- ${path}`).join("\n")}\n\nOuverte par Cockpit`,
            },
          ));
        } catch (pullError) {
          // Best effort: a branch left behind is harmless, and the refusal below matters more. After a timeout GitHub may have opened the pull request anyway: deleting the branch closes it, which beats a duplicate on the next try.
          await octokit
            // The branch is in the URL itself: a {ref} would have its slash encoded.
            .request(`DELETE /repos/{owner}/{repo}/git/refs/heads/${branch}`, {
              owner,
              repo: name,
            })
            .catch((deleteError) =>
              console.error(`Could not delete branch ${branch}`, deleteError),
            );
          const { status: pullStatus, message: pullReason } = pullError as {
            status?: number;
            message: string;
          };
          // The App lacks Pull requests: write; any other 403 (a rate limit) is not a refusal.
          if (
            pullStatus === 403 &&
            /not accessible by integration/i.test(pullReason)
          )
            return { refused: "pull_request_forbidden" };
          throw pullError;
        }
        // Parsed once the pull request exists: a parse error must not delete its branch.
        const pull = pullRequestSchema.parse(data);
        return {
          commitSha,
          pullRequest: { number: pull.number, url: pull.html_url },
        };
      }
      // GitHub refuses what is not a fast forward: someone pushed meanwhile, and we do not retry.
      if (status === 422 && /fast.forward/i.test(reason))
        return { refused: "repo_changed" };
      throw error;
    }
    return { commitSha };
  };

  return {
    /** Whether this client signed the plan, so its files are as `planRepoWrite` gave them (decision 026 H). */
    isPlanSigned: isSigned,
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

    /** Whether `owner/name` exists on GitHub, as the installation sees it: a private repo of someone else reads as free (decision 068, then `generateRepo` refuses). */
    async repoExists(installationId: number, owner: string, name: string) {
      const octokit = await app.getInstallationOctokit(installationId);
      try {
        await octokit.request("GET /repos/{owner}/{repo}", {
          owner,
          repo: name,
        });
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },

    /** A new repo from a template, created with the user's own token (decision 068 D); GitHub's refusal comes back as its message, any other failure is thrown. */
    async generateRepo(
      userToken: string,
      template: string,
      repo: {
        owner: string;
        name: string;
        description?: string;
        private: boolean;
      },
    ): Promise<{ repo: z.infer<typeof repoSchema> } | { refused: string }> {
      const [templateOwner, templateRepo] = template.split("/") as [
        string,
        string,
      ];
      try {
        const { data } = await new TimedOctokit({
          auth: userToken,
        }).request("POST /repos/{template_owner}/{template_repo}/generate", {
          template_owner: templateOwner,
          template_repo: templateRepo,
          ...repo,
          include_all_branches: false,
        });
        return { repo: repoSchema.parse(data) };
      } catch (error) {
        const { status, response } = error as {
          status?: number;
          response?: { data?: { message?: unknown } };
        };
        if (status === undefined || status >= 500) throw error;
        return { refused: String(response?.data?.message ?? status) };
      }
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
        // shortcut: named teams (decision 032) are not listed in that case, so they are not checked; add a fourth read if a `.claude` that huge shows up.
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
      // Only trusted paths come here (constants, or names checked against AGENT_NAME): `{+path}` keeps `?` and `#` as they are.
      const readFile = async (path: string) => {
        try {
          const { data } = await octokit.request(
            "GET /repos/{owner}/{repo}/contents/{+path}",
            { owner, repo, path, ref: root.sha },
          );
          const file = contentsSchema.parse(data);
          return file && Buffer.from(file.content, "base64").toString("utf8");
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      };
      const [claude, workflows, github, mcpJson] = await Promise.all([
        rootTrees.includes(".claude") ? readClaude() : ([] as string[]),
        rootTrees.includes(".github")
          ? readTree(at(".github/workflows")).then((t) =>
              blobs(t, ".github/workflows/"),
            )
          : [],
        rootTrees.includes(".github")
          ? readTree(at(".github")).then((t) => blobs(t, ".github/"))
          : [],
        rootBlobs.includes(".mcp.json") ? readFile(".mcp.json") : null,
      ]);
      // A second wave, only when team.md or named teams are there: they are listed by the .claude read above.
      const teamNames = claude
        .map((p) => /^\.claude\/teams\/([^/]+)\.md$/.exec(p)?.[1])
        .filter(
          (name) =>
            name !== undefined &&
            name.length <= MAX_TEAM_NAME &&
            AGENT_NAME.test(name),
        );
      const [teamMd, ...teams] = await Promise.all([
        claude.includes(".claude/team.md") ? readFile(".claude/team.md") : null,
        ...teamNames.map(
          async (name) => (await readFile(`.claude/teams/${name}.md`)) ?? "",
        ),
      ]);
      const paths = [...rootBlobs, ...claude, ...workflows, ...github];
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
        teamMd,
        teams,
        agents: filesIn(".claude/agents"),
        devUsSkill: filesIn(".claude/skills/dev-us"),
        rootFiles: rootBlobs,
        githubFiles: filesIn(".github"),
      };
      return {
        unchanged: false as const,
        files,
        commitSha: root.sha,
        etag: root.etag,
      };
    },

    /** The reading of decision 026 (`inspect`) on its own, as the installation: the files of one repo at a commit (decision 043 C). */
    async fileReader(installationId: number, fullName: string) {
      const { inspect, head, octokit, owner, name } = await writeAccess(
        installationId,
        fullName,
      );
      return {
        inspect,
        head,
        /** The names of the regular files directly in a directory of a commit (`""` for the root), none when it does not exist (decision 052 L). */
        async listFiles(dir: string, sha: string) {
          try {
            const { data } = await octokit.request(
              "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
              {
                owner,
                repo: name,
                tree_sha: dir ? `${sha}:${dir}` : sha,
              },
            );
            return treeSchema
              .parse(data)
              .tree.filter((entry) => entry.type === "blob")
              .map((entry) => entry.path);
          } catch (error) {
            const status = (error as { status?: number }).status;
            if (status === 404 || status === 422) return [];
            throw error;
          }
        },
      };
    },

    /** The permissions of the App and of one installation, read as the App (decision 052 B), with the page where the installation is approved. Errors are left to the caller. */
    async readAppAccess(installationId: number) {
      // Both are awaited before anything is thrown, so no request outlives the call.
      const [asApp, asInstallation] = await Promise.allSettled([
        app.octokit.request("GET /app"),
        app.octokit.request("GET /app/installations/{installation_id}", {
          installation_id: installationId,
        }),
      ]);
      if (asApp.status === "rejected") throw asApp.reason;
      if (asInstallation.status === "rejected") throw asInstallation.reason;
      const installed = installationAccessSchema.parse(
        asInstallation.value.data,
      );
      return {
        app: appAccessSchema.parse(asApp.value.data).permissions,
        appEvents: appAccessSchema.parse(asApp.value.data).events,
        installation: installed.permissions,
        installationUrl: installed.html_url,
      };
    },

    // shortcut: Dependabot's `page` parameter is being closed down in favour of `before` / `after` cursors, upgrade the Dependabot read when GitHub removes it.
    /** The open alerts of a tool, as the installation, 100 per page and ten pages at most (decision 052 C). `disabled` when GitHub answers 403 or 404 (the tool is not on for this repo); `complete` is false when the last page was full, so more may exist. Other errors are left to the caller. */
    async readAlerts<T extends AlertTool>(
      installationId: number,
      fullName: string,
      tool: T,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const { path, schema } = ALERT_TOOLS[tool];
      const alerts: z.infer<(typeof ALERT_TOOLS)[T]["schema"]>[] = [];
      for (let page = 1; page <= MAX_ALERT_PAGES; page++) {
        let data: unknown;
        try {
          ({ data } = await octokit.request(
            `GET /repos/{owner}/{repo}/${path}/alerts`,
            {
              owner,
              repo,
              state: "open",
              per_page: PAGE_SIZE,
              page,
              // GitHub then does not even send the value of a secret.
              ...(tool === "secret_scanning" && { hide_secret: true }),
            },
          ));
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (status === 403 || status === 404)
            return { disabled: true as const };
          throw error;
        }
        const found = z.array(schema).parse(data) as typeof alerts;
        alerts.push(...found);
        if (found.length < PAGE_SIZE)
          return { alerts, complete: true as const };
      }
      return { alerts, complete: false as const };
    },

    /** The first place in a commit where a secret scanning alert found its secret (decision 052 D), null when it has none. Never the secret itself. Errors are left to the caller. */
    async readSecretLocation(
      installationId: number,
      fullName: string,
      number: number,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/secret-scanning/alerts/{alert_number}/locations",
        { owner, repo, alert_number: number },
      );
      for (const location of locationsSchema.parse(data)) {
        const found = commitLocationSchema.safeParse(location.details);
        if (location.type === "commit" && found.success)
          return {
            path: found.data.path,
            startLine: found.data.start_line,
            endLine: found.data.end_line,
            commitSha: found.data.commit_sha,
          };
      }
      return null;
    },

    /** How many commits `branch` has that `sha` has not (the `ahead_by` of GitHub's compare), null when GitHub does not know the commit any more (a force-push, decision 043 G). Other errors are left to the caller. */
    async commitsSince(
      installationId: number,
      fullName: string,
      sha: string,
      branch: string,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      try {
        const { data } = await octokit.request(
          `GET /repos/{owner}/{repo}/compare/{sha}...${branch.split("/").map(encodeURIComponent).join("/")}`,
          { owner, repo, sha },
        );
        return z.object({ ahead_by: z.number().int() }).parse(data).ahead_by;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
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

    /** The head of a pull request, as the installation: null when GitHub answers 404 (decision 035 C). Other errors are left to the caller. */
    async readPullRequest(
      installationId: number,
      fullName: string,
      number: number,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      try {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}",
          { owner, repo, pull_number: number },
        );
        const { head } = pullHeadSchema.parse(data);
        return { branch: head.ref, repo: head.repo?.full_name ?? null };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    /** A PR as the follow of decision 038 B needs it: its state, its merge, and the check runs of its head commit and its reviews (oldest first). The three reads all succeed or this throws, so nothing is written on a half read. Shortcut: only the first 100 check runs and 100 reviews, paginate if a PR ever has more. */
    async readPullFollow(
      installationId: number,
      fullName: string,
      number: number,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const pull = pullStateSchema.parse(
        (
          await octokit.request(
            "GET /repos/{owner}/{repo}/pulls/{pull_number}",
            {
              owner,
              repo,
              pull_number: number,
            },
          )
        ).data,
      );
      const runs = checkRunsSchema.parse(
        (
          await octokit.request(
            "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
            { owner, repo, ref: pull.head.sha, per_page: 100 },
          )
        ).data,
      );
      const reviews = reviewsSchema.parse(
        (
          await octokit.request(
            "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
            { owner, repo, pull_number: number, per_page: 100 },
          )
        ).data,
      );
      return {
        open: pull.state === "open",
        merged: pull.merged,
        checkRuns: runs.check_runs,
        reviews: reviews.flatMap((r) =>
          r.user ? [{ login: r.user.login, state: r.state }] : [],
        ),
      };
    },

    /** The paths a PR changes, in GitHub's order, all pages of 100 (decision 050 C). Throws on any GitHub error. */
    async readPullFiles(
      installationId: number,
      fullName: string,
      number: number,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const paths: string[] = [];
      // shortcut: GitHub serves 3000 files per PR at most, past that the count undercounts; nothing to upgrade to.
      for (let page = 1; page <= PULL_FILES_MAX_PAGES; page++) {
        const files = pullFilesSchema.parse(
          (
            await octokit.request(
              "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
              { owner, repo, pull_number: number, per_page: PAGE_SIZE, page },
            )
          ).data,
        );
        // A renamed file counts both paths (decision 050 D).
        paths.push(
          ...files.flatMap((f) =>
            f.previous_filename
              ? [f.filename, f.previous_filename]
              : [f.filename],
          ),
        );
        if (files.length < PAGE_SIZE) break;
      }
      return paths;
    },

    /** The PRs merged into `base` (decision 062 A): the closed ones, 100 per page, 3 pages at most, most recently updated first. Shortcut: older PRs are not listed, paginate further if it ever matters. */
    async listMergedPulls(
      installationId: number,
      fullName: string,
      base: string,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const found: z.infer<typeof mergedPullsSchema> = [];
      for (let page = 1; page <= CHANGELOG_PULL_PAGES; page++) {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/pulls",
          {
            owner,
            repo,
            state: "closed",
            base,
            sort: "updated",
            direction: "desc",
            per_page: PAGE_SIZE,
            page,
          },
        );
        const pulls = mergedPullsSchema.parse(data);
        found.push(...pulls);
        if (pulls.length < PAGE_SIZE) break;
      }
      return found.filter((p) => p.merged_at !== null);
    },

    /** The published releases of the repo, drafts left out, 100 at most (decision 062 A); `cut` when GitHub sent a full page, drafts counted: older releases may exist. */
    async listReleases(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/releases",
        { owner, repo, per_page: PAGE_SIZE },
      );
      const all = releasesSchema.parse(data);
      const releases = all.flatMap((r) =>
        r.draft || !r.published_at
          ? []
          : [
              {
                tag: r.tag_name,
                name: r.name || r.tag_name,
                publishedAt: r.published_at,
              },
            ],
      );
      return { releases, cut: all.length >= PAGE_SIZE };
    },

    /** The branches of the repo with the commit each points at, 100 per page, 10 pages at most (decision 062 D). */
    async listBranches(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const found: { name: string; sha: string }[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/branches",
          { owner, repo, per_page: PAGE_SIZE, page },
        );
        const branches = branchesSchema.parse(data);
        found.push(
          ...branches.map((b) => ({ name: b.name, sha: b.commit.sha })),
        );
        if (branches.length < PAGE_SIZE) break;
      }
      return found;
    },

    /** What decision 062 E checks right before deleting a branch, read live: the PR (merged, last commit), the branch (null when gone) and whether an open PR starts from it. Throws on any GitHub error. */
    async readBranchToDelete(
      installationId: number,
      fullName: string,
      prNumber: number,
      branch: string,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const pull = mergedPullsSchema.element.parse(
        (
          await octokit.request(
            "GET /repos/{owner}/{repo}/pulls/{pull_number}",
            {
              owner,
              repo,
              pull_number: prNumber,
            },
          )
        ).data,
      );
      // The branch is in the URL itself: a {branch} would have its slash encoded.
      const found = await octokit
        .request(
          `GET /repos/{owner}/{repo}/branches/${branch.split("/").map(encodeURIComponent).join("/")}`,
          { owner, repo },
        )
        .then(({ data }) => branchesSchema.element.parse(data))
        .catch((error) => {
          if (isNotFound(error)) return null;
          throw error;
        });
      const { data: open } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls",
        { owner, repo, state: "open", head: `${owner}:${branch}`, per_page: 1 },
      );
      return {
        merged: pull.merged_at !== null,
        pullHeadSha: pull.head.sha,
        branch: found && { protected: found.protected, sha: found.commit.sha },
        hasOpenPull: mergedPullsSchema.parse(open).length > 0,
      };
    },

    /** Deletes the branch reference (decision 062 E); the caller has checked that nothing is lost. */
    async deleteBranch(
      installationId: number,
      fullName: string,
      branch: string,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      await octokit.request(
        `DELETE /repos/{owner}/{repo}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
        { owner, repo },
      );
    },

    /** The App's webhook as GitHub holds it, read as the App (decision 024 F): its config and the status code of its last delivery, null when it has none. Errors are left to the caller. */
    async readWebhook() {
      // One after the other: with Promise.all a failure would leave the second request running after the call is over.
      const config = await app.octokit.request("GET /app/hook/config");
      const deliveries = await app.octokit.request("GET /app/hook/deliveries", {
        per_page: 1,
      });
      return {
        ...hookConfigSchema.parse(config.data),
        lastStatus:
          hookDeliveriesSchema.parse(deliveries.data)[0]?.status_code ?? null,
      };
    },

    /** What writing `files` into the default branch would do (decision 026 A): each file is `create`, `same`, `update` (its repo text is an old copy according to `isOldCopy`) or `exists` (never overwritten). Refused when the repo is empty or out of reach. Reads only. Throws on an invalid plan and on any other GitHub error. */
    async planRepoWrite(
      installationId: number,
      fullName: string,
      files: (WriteFile & { unlessExists?: string[] })[],
      isOldCopy: (path: string, text: string) => boolean = () => false,
      // The text an `update` file is given instead of its own `content` (the repo's model line kept, decision 051 L).
      updated: (path: string, current: string) => string = (path) =>
        files.find((f) => f.path === path)?.content as string,
    ): Promise<RepoWritePlan | RepoWriteRefusal> {
      checkWriteFiles(files);
      const repo = await writeAccess(installationId, fullName);
      const head = await repo.head();
      if ("refused" in head) return head;
      const planned = await Promise.all(
        files.map(
          async ({
            unlessExists = [],
            ...file
          }): Promise<RepoWritePlan["files"][number] | null> => {
            // Left out of the plan entirely (so it stays signed) when any of these paths is there, whatever it is.
            const others = await Promise.all(
              unlessExists.map((path) => repo.inspect(path, head.sha)),
            );
            if (others.some((state) => state !== null)) return null;
            const found = await repo.inspect(file.path, head.sha);
            if (!found) return { ...file, status: "create" };
            if (found.text === file.content) return { ...file, status: "same" };
            if (found.text !== undefined && isOldCopy(file.path, found.text))
              return {
                ...file,
                status: "update",
                content: updated(file.path, found.text),
                current: found.text,
              };
            return {
              ...file,
              status: "exists",
              ...(found.text !== undefined && { current: found.text }),
            };
          },
        ),
      );
      const unsigned = {
        baseSha: head.sha,
        files: planned.filter((file) => file !== null),
      };
      return { ...unsigned, signature: sign(unsigned) };
    },

    /** Writes the `create` and `update` files of the plan in ONE commit on the default branch, and nothing else (decision 026 A to C, 049 G). The files are read again at the head of the branch (`repo_changed` when a `create` one is no longer absent or an `update` one is no longer its `current`), unless the plan is signed by this client and the branch is still at its base (decision 026 H). The branch is advanced without force, once; when it is protected, the commit goes to a branch `cockpit/<7>` and a pull request is opened (G). With nothing to write nothing is called and `commitSha` is the plan's base; `created` lists the paths written. */
    async applyRepoWrite(
      installationId: number,
      fullName: string,
      // `unlessExists` (never part of the signature) is checked again with the create files, as `planRepoWrite` did (decision 013 C).
      plan: Omit<RepoWritePlan, "files"> & {
        files: (RepoWritePlan["files"][number] & { unlessExists?: string[] })[];
      },
      message: string,
    ): Promise<
      | {
          commitSha: string;
          created: string[];
          pullRequest?: { number: number; url: string };
        }
      | RepoWriteRefusal
    > {
      checkWriteFiles(plan.files);
      const toCreate = plan.files.filter(
        (file) => file.status === "create" || file.status === "update",
      );
      if (toCreate.length === 0)
        return { commitSha: plan.baseSha, created: [] };
      const repo = await writeAccess(installationId, fullName);
      const head = await repo.head();
      if ("refused" in head) return head;
      if (!(isSigned(plan) && head.sha === plan.baseSha)) {
        const changed = await Promise.all(
          toCreate.map(async (file) => {
            const found = await repo.inspect(file.path, head.sha);
            const others = await Promise.all(
              (file.unlessExists ?? []).map((path) =>
                repo.inspect(path, head.sha),
              ),
            );
            return (
              others.some((state) => state !== null) ||
              (file.status === "update"
                ? found?.text !== file.current
                : found !== null)
            );
          }),
        );
        if (changed.some(Boolean)) return { refused: "repo_changed" };
      }
      const done = await commitToHead(
        repo,
        head,
        toCreate.map((file) => ({
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          content: file.content,
        })),
        message,
      );
      if ("refused" in done) return done;
      return { ...done, created: toCreate.map((file) => file.path) };
    },

    /** The names of the branches of a repo, in GitHub's order, read as the App (decision 034 C). Shortcut: the first page of 100 only, upgrade with pagination when a repo has more. Errors are left to the caller. */
    async readBranches(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/branches",
        { owner, repo, per_page: 100 },
      );
      return z
        .array(z.object({ name: z.string() }))
        .parse(data)
        .map((branch) => branch.name);
    },

    /** The regular files `<name>.md` directly in `.claude/agents` of the default branch, by name, with their text (null when GitHub does not serve it: too large), and the text of `.claude/team.md` (null when absent or unreadable). No such directory: no agents. Reads only (decisions 030 B, 031 G). */
    async readAgentFiles(
      installationId: number,
      fullName: string,
    ): Promise<
      | {
          agents: { name: string; text: string | null }[];
          team: string | null;
          teams: { name: string; text: string }[];
        }
      | RepoWriteRefusal
    > {
      const repo = await writeAccess(installationId, fullName);
      const head = await repo.head();
      if ("refused" in head) return head;
      // null only for no file: one that cannot be read gives "", which the page shows as not rewritable.
      const found = await repo.inspect(".claude/team.md", head.sha);
      const team = found === null ? null : (found.text ?? "");
      const blobsOf = (dir: string) => entriesOf(repo, head.sha, dir, "blob");
      const agentNames = mdNames(
        (await blobsOf(".claude/agents")).filter((e) =>
          /^100(644|755)$/.test(e.mode),
        ),
        Infinity,
      );
      // Decision 032 D: every entry named like a team is listed, a symlink or a too large file with an empty text.
      const teamNames = mdNames(await blobsOf(".claude/teams"), MAX_TEAM_NAME);
      return {
        team,
        teams: await Promise.all(
          teamNames.map(async (name) => ({
            name,
            text:
              (await repo.inspect(`.claude/teams/${name}.md`, head.sha))
                ?.text ?? "",
          })),
        ),
        agents: await Promise.all(
          agentNames.map(async (name) => ({
            name,
            text:
              (await repo.inspect(`.claude/agents/${name}.md`, head.sha))
                ?.text ?? null,
          })),
        ),
      };
    },

    /** What Claude reads in the repo beside the agents (decision 065 A): `CLAUDE.md` and `.mcp.json` (null when absent), the rules `.claude/rules/<name>.md` and the skills `.claude/skills/<name>/SKILL.md` of the default branch, by name, a text that cannot be read being "". Reads only. */
    async readClaudeConfig(
      installationId: number,
      fullName: string,
    ): Promise<
      | {
          claudeMd: string | null;
          mcpJson: string | null;
          rules: { name: string; text: string }[];
          skills: { name: string; text: string }[];
        }
      | RepoWriteRefusal
    > {
      const repo = await writeAccess(installationId, fullName);
      const head = await repo.head();
      if ("refused" in head) return head;
      // null only for no file, as for team.md.
      const read = async (path: string) => {
        const found = await repo.inspect(path, head.sha);
        return found === null ? null : (found.text ?? "");
      };
      const { files: rules, skills } = await readNamed(
        repo,
        head.sha,
        ".claude/rules",
        ".claude/skills",
      );
      return {
        claudeMd: await read("CLAUDE.md"),
        mcpJson: await read(".mcp.json"),
        rules,
        skills,
      };
    },

    /** The agents `plugins/commun/agents/<name>.md` and skills `plugins/commun/skills/<name>/SKILL.md` of the plugin repo (decision 066 D), as `readClaudeConfig` reads rules and skills. Reads only. */
    async readPlugins(
      installationId: number,
      fullName: string,
    ): Promise<
      | {
          agents: { name: string; text: string }[];
          skills: { name: string; text: string }[];
        }
      | RepoWriteRefusal
    > {
      const repo = await writeAccess(installationId, fullName);
      const head = await repo.head();
      if ("refused" in head) return head;
      const { files, skills } = await readNamed(
        repo,
        head.sha,
        "plugins/commun/agents",
        "plugins/commun/skills",
      );
      return { agents: files, skills };
    },

    // shortcut: the first 100 workflows only, a repo with more shows its first ones; page it if it ever matters.
    /** The workflows of the repo and, for each, its 10 newest runs on a branch, newest first (decision 067 B). Errors are left to the caller. */
    async readWorkflowRuns(
      installationId: number,
      fullName: string,
      branch: string,
    ) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const { data } = await octokit.request(
        "GET /repos/{owner}/{repo}/actions/workflows",
        { owner, repo, per_page: PAGE_SIZE },
      );
      return Promise.all(
        workflowsSchema
          .parse(data)
          .workflows.filter(
            (w) =>
              w.state === "active" && w.path.startsWith(".github/workflows/"),
          )
          .map(async (w) => {
            const { data: runs } = await octokit.request(
              "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
              { owner, repo, workflow_id: w.id, branch, per_page: 10 },
            );
            return {
              path: w.path,
              name: w.name,
              runs: workflowRunsSchema.parse(runs).workflow_runs,
            };
          }),
      );
    },

    /** Replaces, removes or adds files in ONE commit on the default branch (decision 030 E). Each path is read again at the head of the branch with the rules of `inspect`: when one is not exactly its `before` (absent for null, a regular file of that text otherwise) nothing is written and the refusal is `repo_changed`. Then as `applyRepoWrite`: no force, a pull request when the branch is protected. */
    async applyRepoChanges(
      installationId: number,
      fullName: string,
      changes: { path: string; before: string | null; after: string | null }[],
      message: string,
    ): Promise<
      | {
          commitSha: string;
          changed: string[];
          pullRequest?: { number: number; url: string };
        }
      | RepoWriteRefusal
    > {
      checkWriteFiles(
        changes.map(({ path, after }) => ({ path, content: after ?? "" })),
      );
      const repo = await writeAccess(installationId, fullName);
      const head = await repo.head();
      if ("refused" in head) return head;
      const found = await Promise.all(
        changes.map((change) => repo.inspect(change.path, head.sha)),
      );
      if (
        changes.some(({ before }, i) =>
          before === null ? found[i] !== null : found[i]?.text !== before,
        )
      )
        return { refused: "repo_changed" };
      const done = await commitToHead(
        repo,
        head,
        changes.map(({ path, after }) => ({
          path,
          mode: "100644" as const,
          type: "blob" as const,
          ...(after === null ? { sha: null } : { content: after }),
        })),
        message,
      );
      if ("refused" in done) return done;
      return { ...done, changed: changes.map((change) => change.path) };
    },

    /** The issues of a repo, open and closed, pull requests left out (decision 057 A). Shortcut: 10 pages of 100 at most, the oldest are not listed. Errors are left to the caller. */
    async listIssues(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      const items: unknown[] = [];
      // Paged by hand, as listInstallationRepos.
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/issues",
          { owner, repo, state: "all", per_page: PAGE_SIZE, page },
        );
        items.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      return z
        .array(
          z.object({
            number: z.number().int(),
            title: z.string(),
            body: z.string().nullish(),
            state: z.enum(["open", "closed"]),
            pull_request: z.unknown().optional(),
          }),
        )
        .parse(items)
        .filter((issue) => !issue.pull_request)
        .map(({ pull_request: _, ...issue }) => issue);
    },

    /** Writes the issues of a repo and the labels Cockpit puts on them (decision 020), as the installation. */
    async issues(installationId: number, fullName: string) {
      const [owner, repo] = fullName.split("/") as [string, string];
      const octokit = await app.getInstallationOctokit(installationId);
      return {
        /** Creates the issue with no label (it may not exist in the repo yet) and returns its number and its labels. */
        async create(issue: { title: string; body: string }) {
          const { data } = await octokit.request(
            "POST /repos/{owner}/{repo}/issues",
            { owner, repo, title: issue.title, body: issue.body },
          );
          return z
            .object({ number: z.number().int(), labels: labelsSchema })
            .parse(data);
        },
        /** Returns the names of the labels the issue carries. */
        async update(
          number: number,
          issue: {
            title: string;
            body: string;
            state: "open" | "closed";
            stateReason: "completed" | "not_planned" | null;
          },
        ) {
          const { data } = await octokit.request(
            "PATCH /repos/{owner}/{repo}/issues/{issue_number}",
            {
              owner,
              repo,
              issue_number: number,
              title: issue.title,
              body: issue.body,
              state: issue.state,
              // GitHub reopens with no reason; sending null would be refused.
              ...(issue.stateReason && { state_reason: issue.stateReason }),
            },
          );
          return z.object({ labels: labelsSchema }).parse(data).labels;
        },
        /** Adds the label and returns the names of all the labels of the issue. GitHub refuses (422) a label missing from the repo: it is created (a 422 there is "already exists") and added again. */
        async addLabel(number: number, name: string) {
          const add = () =>
            octokit.request(
              "POST /repos/{owner}/{repo}/issues/{issue_number}/labels",
              { owner, repo, issue_number: number, labels: [name] },
            );
          try {
            return labelsSchema.parse((await add()).data);
          } catch (error) {
            if ((error as { status?: number }).status !== 422) throw error;
          }
          await ignoreStatus(
            422,
            octokit.request("POST /repos/{owner}/{repo}/labels", {
              owner,
              repo,
              name,
            }),
          );
          return labelsSchema.parse((await add()).data);
        },
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

/** The settings page of the App on GitHub. */
export const appSettingsUrl = (slug: string) =>
  `https://github.com/settings/apps/${slug}`;

/** The client, the App's install and settings pages and the instance's public URL, null before the wizard has run. The client is built once and keeps its installation tokens; the public URL is read each time. */
export function githubReader(readInstance: ReadInstance) {
  let built:
    | {
        github: ReturnType<typeof githubClient>;
        installUrl: string;
        appSettingsUrl: string;
      }
    | undefined;
  return async () => {
    const settings = await readInstance();
    if (!settings) return null;
    built ??= {
      github: githubClient({
        githubAppId: settings.githubAppId,
        githubAppSlug: settings.githubAppSlug,
        githubAppPrivateKey: settings.githubPrivateKey,
      }),
      installUrl: `https://github.com/apps/${settings.githubAppSlug}/installations/new`,
      appSettingsUrl: appSettingsUrl(settings.githubAppSlug),
    };
    return { ...built, publicUrl: settings.publicUrl };
  };
}

export type ReadGitHub = ReturnType<typeof githubReader>;
