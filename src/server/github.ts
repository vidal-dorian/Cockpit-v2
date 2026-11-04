import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
const repoSchema = z.object({
  id: z.number().int(),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
});

/** What we read of the App's webhook (decision 024 F); `active` is only there if GitHub sends it. */
const hookConfigSchema = z.object({
  url: z.string(),
  active: z.boolean().optional(),
});
const hookDeliveriesSchema = z.array(z.object({ status_code: z.number() }));

/** What the cache (decision 013) remembers of a repo: the commit (the `sha` GitHub returns for `HEAD`) it was computed from. */
export type KnownRoot = { etag: string; commitSha: string };

/** What the health check (decision 013) reads of a repo's default branch. */
export type RepoFiles = {
  claudeMd: boolean;
  /** Names of the files directly in .github/workflows. */
  workflows: string[];
  /** The text of .mcp.json, null when absent. */
  mcpJson: string | null;
  /** The text of .claude/team.md (decision 028), null when absent. */
  teamMd: string | null;
  /** Names of the files directly in .claude/agents. */
  agents: string[];
  /** Names of the files directly in .claude/skills/dev-us. */
  devUsSkill: string[];
};

const isNotFound = (error: unknown) =>
  (error as { status?: number }).status === 404;

// Decision 026 D: what a plan to write may hold.
const MAX_WRITE_FILES = 50;
const MAX_WRITE_BYTES = 1_048_576;
const MAX_PATH_LENGTH = 255;

/** A file to add to a repo (decision 026). */
export type WriteFile = { path: string; content: string };
/** What `planRepoWrite` says of one file (a file given with `unlessExists`, a list of paths, is left out when any of them is there, decision 027 B): `exists` is never written, `current` is then the text in the repo. */
export type RepoWritePlan = {
  baseSha: string;
  /** Proves the plan comes from `planRepoWrite` of this client and was not touched (decision 026 H). */
  signature?: string;
  files: (WriteFile & {
    status: "create" | "same" | "exists";
    current?: string;
  })[];
};
/** Why a write is refused (decision 026 C, E and G); refusals are returned, not thrown. */
export type RepoWriteRefusal = {
  refused:
    | "empty_repo"
    | "repo_unreachable"
    | "repo_changed"
    | "pull_request_forbidden";
};

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
            "GET /repos/{owner}/{repo}/contents/{path}",
            { owner, repo: name, path, ref: sha },
          );
          const file = Array.isArray(data) ? null : contentsSchema.parse(data);
          if (!file || file.encoding === "none") return {};
          return { text: Buffer.from(file.content, "base64").toString("utf8") };
        }
      },
    };
  };

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
      const readFile = async (path: string) => {
        try {
          const { data } = await octokit.request(
            "GET /repos/{owner}/{repo}/contents/{path}",
            { owner, repo, path, ref: root.sha },
          );
          const file = contentsSchema.parse(data);
          return file && Buffer.from(file.content, "base64").toString("utf8");
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      };
      const [claude, workflows, mcpJson] = await Promise.all([
        rootTrees.includes(".claude") ? readClaude() : ([] as string[]),
        rootTrees.includes(".github")
          ? readTree(at(".github/workflows")).then((t) =>
              blobs(t, ".github/workflows/"),
            )
          : [],
        rootBlobs.includes(".mcp.json") ? readFile(".mcp.json") : null,
      ]);
      // A second wave, only when team.md is there: it is listed by the .claude read above.
      const teamMd = claude.includes(".claude/team.md")
        ? await readFile(".claude/team.md")
        : null;
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
        teamMd,
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

    /** Points the App's webhook at `url`, as the App (decision 024 G). Errors are left to the caller. */
    async setWebhookUrl(url: string) {
      // `data`, not a bare `url`: Octokit would take that one for the address of the request.
      await app.octokit.request("PATCH /app/hook/config", { data: { url } });
    },

    /** What writing `files` into the default branch would do (decision 026 A): each file is `create`, `same` or `exists` (never overwritten). Refused when the repo is empty or out of reach. Reads only. Throws on an invalid plan and on any other GitHub error. */
    async planRepoWrite(
      installationId: number,
      fullName: string,
      files: (WriteFile & { unlessExists?: string[] })[],
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

    /** Adds the `create` files of the plan in ONE commit on the default branch, and nothing else (decision 026 A to C). The files to create are read again at the head of the branch (`repo_changed` when one is no longer absent), unless the plan is signed by this client and the branch is still at its base (decision 026 H). The branch is advanced without force, once; when it is protected, the commit goes to a branch `cockpit/<7>` and a pull request is opened (G). With nothing to create nothing is called and `commitSha` is the plan's base. */
    async applyRepoWrite(
      installationId: number,
      fullName: string,
      plan: RepoWritePlan,
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
      const toCreate = plan.files.filter((file) => file.status === "create");
      if (toCreate.length === 0)
        return { commitSha: plan.baseSha, created: [] };
      const repo = await writeAccess(installationId, fullName);
      const head = await repo.head();
      if ("refused" in head) return head;
      if (!(isSigned(plan) && head.sha === plan.baseSha)) {
        const found = await Promise.all(
          toCreate.map((file) => repo.inspect(file.path, head.sha)),
        );
        if (found.some((state) => state !== null))
          return { refused: "repo_changed" };
      }
      const { octokit, owner, name } = repo;
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
          tree: toCreate.map((file) => ({
            path: file.path,
            mode: "100644" as const,
            type: "blob" as const,
            content: file.content,
          })),
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
        // Both the texts of a protected branch and of a ruleset; 403 or 422 depending on the rule (decision 026 G).
        if (
          (status === 403 || status === 422) &&
          /protected branch|rule violation/i.test(reason)
        ) {
          const branch = `cockpit/${commitSha.slice(0, 7)}`;
          const created = toCreate.map((file) => file.path);
          await octokit.request("POST /repos/{owner}/{repo}/git/refs", {
            owner,
            repo: name,
            ref: `refs/heads/${branch}`,
            sha: commitSha,
          });
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
                body: `${created.map((path) => `- ${path}`).join("\n")}\n\nOuverte par Cockpit`,
              },
            ));
          } catch (pullError) {
            // Best effort: a branch left behind is harmless, and the refusal below matters more. After a timeout GitHub may have opened the pull request anyway: deleting the branch closes it, which beats a duplicate on the next try.
            await octokit
              // The branch is in the URL itself: a {ref} would have its slash encoded.
              .request(
                `DELETE /repos/{owner}/{repo}/git/refs/heads/${branch}`,
                {
                  owner,
                  repo: name,
                },
              )
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
            created,
            pullRequest: { number: pull.number, url: pull.html_url },
          };
        }
        // GitHub refuses what is not a fast forward: someone pushed meanwhile, and we do not retry.
        if (status === 422 && /fast.forward/i.test(reason))
          return { refused: "repo_changed" };
        throw error;
      }
      return { commitSha, created: toCreate.map((file) => file.path) };
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

/** The client, the App's install and settings pages and the instance's public URL, null before the wizard has run. The client is built once and keeps its installation tokens; the public URL is read each time, as the administrator can change it (decision 023 C). */
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
