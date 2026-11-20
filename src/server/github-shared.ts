import type { App } from "@octokit/app";
import { Octokit } from "@octokit/core";
import { z } from "zod";
export type GitHubAppConfig = {
  githubAppId: string;
  githubAppSlug: string;
  /** The PEM text, already decoded from the base64 of the environment (decision 011 H). */
  githubAppPrivateKey: string;
};

export const PAGE_SIZE = 100;
// shortcut: 1000 repos at most, a user with more only sees the first ones; raise it if it ever matters.
export const MAX_PAGES = 10;
export const PULL_FILES_MAX_PAGES = 30;
// Shorter than Cloudflare's ~100 s limit, so a slow GitHub ends on our 502, not a 524 (as in auth.ts).
export const GITHUB_TIMEOUT_MS = 10_000;

// A rate limit asking for longer than this is not waited out: the call fails fast, and a webhook delivery is tried again later.
export const MAX_RATE_LIMIT_WAIT_S = 30;

/** Whether GitHub refused for its rate limits (429, or 403 with Retry-After, no request left, or a secondary limit that only says so in its message), not for another reason. */
export function isRateLimited(error: unknown) {
  const { status, message, response } = error as {
    status?: number;
    message?: string;
    response?: { headers?: Record<string, string | undefined> };
  };
  const headers = response?.headers ?? {};
  return (
    status === 429 ||
    (status === 403 &&
      (headers["retry-after"] !== undefined ||
        headers["x-ratelimit-remaining"] === "0" ||
        /rate limit/i.test(message ?? "")))
  );
}

/** Waits the Retry-After of a rate limit, then asks once more. (@octokit/plugin-throttling ignores Retry-After on 429 and on primary limits.) */
export function retryAfterRateLimit(octokit: Octokit) {
  octokit.hook.wrap("request", async (request, options) => {
    try {
      return await request(options);
    } catch (error) {
      const wait = Number(
        (error as { response?: { headers?: Record<string, string> } }).response
          ?.headers?.["retry-after"],
      );
      if (!isRateLimited(error) || !(wait > 0 && wait <= MAX_RATE_LIMIT_WAIT_S))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return request(options);
    }
  });
}

// Looks the global fetch up at call time, so a test's stub still applies.
export const TimedOctokit = Octokit.plugin(retryAfterRateLimit).defaults({
  request: {
    fetch: (url: string, init?: RequestInit) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) }),
  },
});

// What we read of GitHub's answers; anything else is ignored.
export const installation = z.object({
  id: z.number().int(),
  account: z.object({ id: z.number().int() }),
});
// A file as the Contents API serves it (GitHub follows a symlink to a file of the repo); any other object counts as absent.
export const contentsSchema = z.union([
  z.object({
    type: z.literal("file"),
    content: z.string(),
    // "none": a file too large for Contents, whose content is then "".
    encoding: z.string(),
  }),
  z.object({ type: z.string() }).transform(() => null),
]);
// A Git tree. `truncated` is GitHub cutting a recursive answer short.
export const treeSchema = z.object({
  sha: z.string(),
  truncated: z.boolean(),
  tree: z.array(
    z.object({ path: z.string(), mode: z.string(), type: z.string() }),
  ),
});
export const shaSchema = z.object({ sha: z.string() });
export const refSchema = z.object({ object: shaSchema });
export const pullRequestSchema = z.object({
  number: z.number().int(),
  html_url: z.string(),
});
// What link_pull_request checks of a PR: its head branch and where it comes from (decision 035 C).
export const pullHeadSchema = z.object({
  head: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
});
// What the follow of a PR reads (decision 038 B).
export const pullStateSchema = z.object({
  state: z.string(),
  merged: z.boolean(),
  head: z.object({ sha: z.string() }),
});
export const checkRunsSchema = z.object({
  check_runs: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
    }),
  ),
});
export const reviewsSchema = z.array(
  z.object({
    user: z.object({ login: z.string() }).nullable(),
    state: z.string(),
  }),
);
export const pullFilesSchema = z.array(
  z.object({ filename: z.string(), previous_filename: z.string().optional() }),
);
export const CHANGELOG_PULL_PAGES = 3;
export const mergedPullsSchema = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    merged_at: z.string().nullable(),
    head: z.object({ sha: z.string() }),
  }),
);
export const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    name: z.string().nullable(),
    draft: z.boolean(),
    published_at: z.string().nullable(),
  }),
);
export const branchesSchema = z.array(
  z.object({
    name: z.string(),
    protected: z.boolean(),
    commit: z.object({ sha: z.string() }),
  }),
);
// What the CI / CD tab reads of the Actions API (decision 067 B).
export const workflowsSchema = z.object({
  workflows: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      path: z.string(),
      state: z.string(),
    }),
  ),
});
export const workflowRunsSchema = z.object({
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
export const repoSchema = z.object({
  id: z.number().int(),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
  // Decision 068 B: « Template repository » in the repo's settings.
  is_template: z.boolean().default(false),
});

/** What we read of the App's webhook (decision 024 F); `active` is only there if GitHub sends it. */
export const hookConfigSchema = z.object({
  url: z.string(),
  active: z.boolean().optional(),
});
export const hookDeliveriesSchema = z.array(
  z.object({ status_code: z.number() }),
);
export const permissionsSchema = z.record(z.string(), z.string()).default({});
export const appAccessSchema = z.object({
  permissions: permissionsSchema,
  events: z.array(z.string()).default([]),
});
export const installationAccessSchema = z.object({
  html_url: z.string(),
  permissions: permissionsSchema,
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

export const isNotFound = (error: unknown) =>
  (error as { status?: number }).status === 404;

// Decision 026 D: what a plan to write may hold.
export const MAX_WRITE_FILES = 50;
export const MAX_WRITE_BYTES = 1_048_576;
export const MAX_PATH_LENGTH = 255;

/** A file to add to a repo (decision 026). */
export type WriteFile = { path: string; content: string };
/** What `planRepoWrite` says of one file (a file given with `unlessExists`, a list of paths, is left out when any of them is there, decision 027 B): `exists` is never written, `current` is then the text in the repo; `update` is an old original copy (decision 049 G), replaced, `current` being its text. */
export type RepoWritePlan = {
  baseSha: string;
  /** Proves the plan comes from `planRepoWrite` of this client and was not touched (decision 026 H). */
  signature?: string;
  files: (WriteFile & {
    status: "create" | "same" | "exists" | "update";
    current?: string;
  })[];
};
/** Why a write is refused (decision 026 C, E and G); refusals are returned, not thrown. */
export type RepoWriteRefusal = {
  refused:
    | "empty_repo"
    | "repo_unreachable"
    | "repo_changed"
    | "pull_request_forbidden"
    | "workflows_forbidden";
};

/** GitHub refusing to write a workflow because the App lacks `workflows` (decision 067 D), whatever the status. */
export const noWorkflowsPermission = (error: unknown) =>
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
export const labelsSchema = z
  .array(z.object({ name: z.string() }))
  .transform((labels) => labels.map((label) => label.name));

export const ignoreStatus = async (status: number, call: Promise<unknown>) => {
  try {
    await call;
  } catch (error) {
    if ((error as { status?: number }).status !== status) throw error;
  }
};

/** Talks to GitHub with the identity of the App only, never a user's token (decision 011). Errors are left to the caller. */

export type GitHubApp = App<{ Octokit: typeof TimedOctokit }>;
