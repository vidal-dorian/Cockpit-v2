import { createHash, generateKeyPairSync } from "node:crypto";
import { expect, onTestFinished, vi } from "vitest";

// A real key, so the GitHub client can sign the JWT of the App; nothing ever leaves the process.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** The GitHub App settings of `createApp`'s config, for tests (decision 011 H). */
export const githubAppConfig = {
  githubAppId: "123456",
  githubAppSlug: "cockpit-test",
  githubAppPrivateKey: privateKey,
};

export type GitHubRepo = {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
};

export const INSTALLATION_ID = 77;

/**
 * What a path of a fake Git repo can be besides a regular file of mode 100644 (`files`); a directory is never listed, it exists when a path is under it (decision 026).
 * - `executable`: a regular file of mode 100755, Contents serves it like any file.
 * - `symlink`: mode 120000 (a blob). `submodule`: a gitlink, tree entry of type `commit`, mode 160000.
 * - `large`: a regular file (100644) too large for Contents, which answers 200 with `content: ""` and `encoding: "none"`.
 */
export type FakeGitEntry =
  | { kind: "executable"; content: string }
  | { kind: "symlink" }
  // GitHub answers 422 or 404 to the tree of a submodule (decision 013 H did not verify which), or even 200 with the tree of its commit when that commit is in the repo's objects: `treeStatus` picks it, 422 by default.
  | { kind: "submodule"; treeStatus?: 404 | 200 }
  | { kind: "large" };

/** A repo with a Git history, for `stubGitHub`'s `gitRepos` (decision 026). */
export type FakeGitRepoOptions = {
  /** Default: "main". */
  defaultBranch?: string;
  /** The regular files of the first commit (all of mode 100644). */
  files?: Record<string, string>;
  /** The other kinds of entries of the first commit, by path. */
  entries?: Record<string, FakeGitEntry>;
  /** No commit at all: reading the default branch answers 409. */
  empty?: boolean;
  unreachable?: boolean;
  refUpdateFailure?: { status: number; message: string };
  /** Fails every `POST .../pulls` with that status and message (decision 026 G: 403 plays an App without Pull requests: write). */
  pullRequestFailure?: { status: number; message: string };
};

/** The address of the App's webhook the stub starts with: the one of `configureTestInstance` (decision 024 F). */
export const DEFAULT_WEBHOOK_URL =
  "https://cockpit.example.com/api/webhooks/github";

/** The App's webhook as the stub holds it (decision 024 F); read and change it between two calls. */
export type FakeWebhook = {
  url: string;
  /** Sent in the answer of `GET /app/hook/config` only when set. */
  active?: boolean;
  /** Newest first, as GitHub lists them. */
  deliveries: { status_code: number }[];
  /** Fails the given call with that status (body message `github-boom-message`). */
  configStatus?: number;
  deliveriesStatus?: number;
};

/** An issue as the fake holds it (slice 4.6, decision 020); `labels` are names. */
export type FakeIssue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  stateReason: string | null;
  html_url: string;
};

/** An issue as GitHub's REST API serves it. */
const serve = ({ labels, stateReason, ...issue }: FakeIssue) => ({
  ...issue,
  labels: labels.map((name) => ({ name })),
  state_reason: stateReason,
});

/** A file as GitHub's Contents API serves it: base64 cut into lines of 60 characters. */
function contentsFile(path: string, text: string) {
  const content = (
    Buffer.from(text)
      .toString("base64")
      .match(/.{1,60}/g) ?? []
  )
    .map((line) => `${line}\n`)
    .join("");
  return {
    type: "file",
    name: path.split("/").pop(),
    path,
    sha: "abc123",
    size: Buffer.byteLength(text),
    encoding: "base64",
    content,
  };
}

/**
 * For a fetch fake: `throw unexpectedFetch(call)` for a call it does not serve. The server can swallow
 * that throw (Octokit and the routes turn it into a 500, then a 502): the test fails anyway when it finishes.
 */
export function failOnUnexpectedFetch() {
  const unexpected: string[] = [];
  onTestFinished(() =>
    expect(unexpected, "calls the fake does not serve").toEqual([]),
  );
  return (call: string) => {
    unexpected.push(call);
    return new Error(`Unexpected fetch ${call}`);
  };
}

/**
 * Stubs the global fetch with the GitHub endpoints the server uses
 * (decisions 011 and 002); any other call fails loudly, and fails the test even when the server swallows it (a 502). `account` is the GitHub id of the
 * installation's account, or null for "the App is not installed" (404).
 *
 * The health check (slice 2.2) reads a repo through small directories only (decision 013):
 * - `files` maps a path of the repo to its text (`repoFiles`: the same per `owner/repo`, for the repos it names; `files` serves the others). `GET /repos/{o}/{r}/git/trees/{treeish}` serves
 *   `HEAD` (the root, not recursive; its `sha` is a COMMIT sha) and `<commit sha>:<dir>` (not recursive,
 *   or `?recursive=1`; paths relative to the dir; 404 when nothing is there, 422 when it is a file, a symlink or a submodule), as blobs (mode 100644) plus trees.
 *   Anything else fails loudly with "Unexpected fetch": `HEAD?recursive=1` (the whole repo) and
 *   `HEAD:<dir>` (a sub-read that is not pinned to the commit the root returned).
 *   The Contents API (`?ref=<commit sha>` is required, a call without it fails loudly) serves a file or a special as such, at a commit sha the root served;
 *   anything else fails loudly with "Unexpected fetch".
 *   The stub keeps a snapshot of the repo for every commit sha it served on the root, and answers the
 *   pinned reads from that snapshot, whatever the repo became since. A sha it never served is 404 (trees).
 *   The options `treesStatus` / `treesTruncated` keep naming the sub-reads `HEAD:<dir>`, whatever sha pins them.
 * - `specials` serves a path as something other than a file or a directory: a
 *   submodule (tree entry `type: "commit"`, mode 160000) or a symlink (blob, mode 120000),
 *   and the Contents API describes them as such.
 * - `treesStatus` fails the trees route with that status, for every tree-ish or only the given
 *   ones (`{ "HEAD:.claude": 500 }`); `treesTruncated` sets `truncated: true` on a recursive
 *   answer of the given tree-ishes, which then holds no entry (GitHub cuts it short); `emptyRepo` answers what
 *   GitHub answers for a repo without commit: 409 "Git Repository is empty." on the trees route.
 * - `contentsStatus` fails the given Contents paths with their status; `networkError` makes every trees and Contents call throw.
 * - `tokenStatus` fails the installation access token; `installations` lists the
 *   installation ids that get one (default: INSTALLATION_ID only, with the token
 *   `ghs_x`; any other id gets `ghs_<id>`).
 *
 * Conditional requests (the health cache, decision 013 G): the root (`HEAD`, no query) carries a
 * commit `sha` and an `ETag` that both derive from the content of the whole repo (a change anywhere,
 * nested files included, changes them), and answers 304 with no body when `If-None-Match` equals
 * its ETag (a failure from `treesStatus` still wins). The returned mock also has
 * `update(patch)`, which changes any of these options between two calls (`files` included, to
 * simulate a push), `rotateEtag()`, which changes the ETag but not the commit sha, and
 * `afterNextRoot(fn)`, which runs `fn` once, right after the next root answer is built (a push
 * landing between the root read and the sub-reads: `fn` calls `update`), and `served`, the commit
 * sha of each root 200, in order.
 *
 * Issues (slice 4.6, decision 020), per `owner/repo`: `POST /repos/{o}/{r}/issues` (title, body, labels; answers `number`
 * and `html_url` = https://github.com/{o}/{r}/issues/{number}, numbers from 1), `PATCH .../issues/{n}` (title, body,
 * state, state_reason, and `labels` which replaces them all), `POST .../issues/{n}/labels`, `DELETE .../issues/{n}/labels/{name}`
 * (404 when the issue does not carry it) and `POST /repos/{o}/{r}/labels` (422 when it exists). A label that does not
 * exist in the repo is refused with 422 when it is added to an issue or given at its creation (stricter than GitHub, which
 * creates it: the server must create it first). A GET of an issue is not served. The returned mock reads and seeds that
 * state: `issues(fullName)`, `labels(fullName)`, `addLabel(fullName, name)` and `addIssueLabel(fullName, number, name)`.
 * `issuesStatus` fails every call on an issue or a label with that status (body message `github-boom-message`),
 * `issuesDelay` makes each of them wait that many milliseconds; `failOn(call)` (call = `{ method, path }`, the path being the URL's) fails
 * with 500 every call it returns true for (or with the status it returns), to break one step of a sync (`(c) => c.method === "PATCH"`); set or clear them with `update(...)`.
 * Like GitHub, an issue created or patched with a title over 256 characters or a body over 65,536 is refused with 422.
 *
 * The webhook of the App (decisions 002 and 024), read as the App itself (a JWT, never an installation token: 401 otherwise):
 * `GET /app/hook/config` (`{ url, content_type, insecure_ssl }`, plus `active` when the test set it) and `GET /app/hook/deliveries?per_page=n` (the `n` newest
 * deliveries, each `{ id, guid, status_code, event, action }`).
 * It starts at DEFAULT_WEBHOOK_URL with no delivery, so a health check reads it green. The returned mock holds it as `webhook` (a live object: assign
 * its fields between two calls, `initial.webhook` seeds them); `configStatus` and `deliveriesStatus` fail one of the two calls.
 *
 * Writing into a repo (slice 6.1, decision 026): `gitRepos` names the repos (`owner/repo`) that keep a real Git history, which the stub serves instead of the snapshots above:
 * `GET /repos/{o}/{r}` (`default_branch`), `GET .../git/ref/heads/{branch}` (only the default branch exists; 409 on an empty repo), `GET .../git/commits/{sha}`,
 * `GET .../git/trees/{sha}:{dir}` (the tree of a directory at a commit; the root is `{sha}` or `{sha}:`; nothing else is served, no query string, no `HEAD`, no branch name; entries are
 * `{ path, mode, type, sha }` with `path` the name inside the directory, `040000`/`tree` for a directory, `100644`/`100755`/`120000` blobs, `160000`/`commit` for a submodule;
 * 404 when the directory is missing, also when one of its parents is a file, a symlink or a submodule; 422 when the path itself is a file, a symlink or a submodule, as GitHub does),
 * `GET .../contents/{path}?ref={sha}` (a regular file, or a file too large to read: `content: ""`, `encoding: "none"`; 404 when the path is absent at that commit; a directory, a symlink or a submodule at the path is not served,
 * the code under test must have read the tree to know it: "Unexpected fetch"), `POST .../git/trees` (needs a known `base_tree`, blobs of mode 100644 with a string `content`),
 * `POST .../git/commits` (known tree and parents) and `PATCH .../git/refs/heads/{branch}` (`{ sha, force }`: like GitHub, 422 "not a fast forward" when the current head is not
 * an ancestor of `sha` and `force` is not `true`). Any other call on such a repo fails loudly. `git(fullName)` is the live state of one of them: `head`, `commit(sha)`, `filesAt(sha)`,
 * `created` (what the code under test sent: `trees`, `commits`, `refUpdates` with their `force`, every attempt included), `push(files)` (another person's push on the default branch:
 * adds or replaces files in a new commit on the head, returns its sha), `beforeRefUpdate(fn)` (runs `fn` once, right before the next ref update is judged: a push landing at that moment),
 * and the fields `unreachable` (every call on the repo answers 404, the App lost access) and `refUpdateFailure` (`{ status, message }`, fails every ref update, to play a protected branch).
 * Pull request on a protected branch (decision 026 G): `POST .../git/refs` (`{ ref: "refs/heads/<name>", sha }`: creates a branch, never moves one; 422 "Reference already exists" when the name is taken, by the default branch or by another
 * branch; 422 when the sha is no known commit; any `force` key is recorded as sent), `DELETE .../git/refs/heads/<name>` (a branch other than the default one; 204, 422 when it does not exist) and `POST .../pulls`
 * (`{ title, head, base, body }`: `head` must be an existing branch other than the default branch and `base` the default branch, else 422; answers 201 `{ number, html_url }`, numbers start at 1, `html_url` is
 * `https://github.com/{o}/{r}/pull/{number}`; `pullRequestFailure` fails it). They are recorded apart from `created` (which the older tests compare with `toEqual`) as `git.refsCreated` (`{ branch, sha, force }`),
 * `git.refsDeleted` (branch names) and `git.pullRequests` (`{ number, head, base, title, body }`); `git.branch(name)` is the sha a branch points at (the default branch included), `undefined` when it does not exist.
 * `GET .../git/ref/heads/<name>` serves these branches too.
 * Reading a PR (slice 7.3, decision 035 C), on any repo: `GET .../pulls/{n}` answers what `addPull(fullName, number, branch, headRepo?)` seeded (`head.ref`, `head.repo.full_name`), 404 otherwise; `failOn` applies.
 * `failOn` applies to these repos too. A tree that would replace anything is accepted, as GitHub does: it is the caller's job not to send it. A blob sent over a directory, a symlink, a submodule or a file replaces it (and
 * everything under a directory), and a blob under a path that is a file, a symlink or a submodule replaces that parent by a directory.
 * `gitRepos` entries take `entries` (see `FakeGitEntry`) next to `files`; `push(files, message, entries)` takes them as its third argument, and `git(...).entriesAt(sha)` reads them.
 */
export function stubGitHub(initial: {
  account: number | null;
  repositories?: GitHubRepo[];
  installationStatus?: number;
  repositoriesStatus?: number;
  files?: Record<string, string>;
  repoFiles?: Record<string, Record<string, string>>;
  contentsStatus?: Record<string, number>;
  specials?: Record<
    string,
    { type: "submodule" } | { type: "symlink"; target: string }
  >;
  networkError?: boolean;
  treesStatus?: number | Record<string, number>;
  treesTruncated?: Record<string, boolean>;
  emptyRepo?: boolean;
  tokenStatus?: number;
  installations?: number[];
  issuesStatus?: number;
  issuesDelay?: number;
  failOn?: (call: { method: string; path: string }) => boolean | number;
  webhook?: Partial<FakeWebhook>;
  gitRepos?: Record<string, FakeGitRepoOptions>;
}) {
  // Mutable on purpose: `update` changes it between two calls.
  const options = { ...initial };
  const webhook: FakeWebhook = {
    url: DEFAULT_WEBHOOK_URL,
    deliveries: [],
    ...initial.webhook,
  };
  let etagSalt = 0;
  let afterRoot: (() => void) | undefined;
  const served: string[] = [];
  type Specials = NonNullable<typeof initial.specials>;
  type RepoView = {
    files: Record<string, string>;
    specials: Specials;
    // Every path of the repo with its tree entry, directories included; built once per repo and change, a test may hold 150,000 files.
    all: Map<string, { mode: string; type: string }>;
  };
  let views = new Map<string, RepoView>();
  // The repo as it was when each commit sha was served on the root: a pinned read answers from here.
  const snapshots = new Map<string, RepoView>();
  const viewOf = (fullName: string): RepoView => {
    const known = views.get(fullName);
    if (known) return known;
    const files = options.emptyRepo
      ? {}
      : (options.repoFiles?.[fullName] ?? options.files ?? {});
    const all = new Map<string, { mode: string; type: string }>();
    const specials = options.specials ?? {};
    for (const path of [...Object.keys(files), ...Object.keys(specials)]) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++)
        all.set(parts.slice(0, i).join("/"), { mode: "040000", type: "tree" });
    }
    for (const path of Object.keys(files))
      all.set(path, { mode: "100644", type: "blob" });
    for (const [path, special] of Object.entries(specials))
      all.set(
        path,
        special.type === "submodule"
          ? { mode: "160000", type: "commit" }
          : { mode: "120000", type: "blob" },
      );
    const view = { files, specials, all };
    views.set(fullName, view);
    return view;
  };
  const installations = options.installations ?? [INSTALLATION_ID];
  const repositories = options.repositories ?? [];
  // The sha of a root entry, like Git's: a blob's changes with its text, a tree's with anything under it.
  const rootShas = (files: Record<string, string>, specials: Specials) => {
    const parts = new Map<string, ReturnType<typeof createHash>>();
    const entries = [
      ...Object.entries(files).map(([p, text]) => [p, text] as const),
      ...Object.entries(specials).map(
        ([p, special]) => [p, JSON.stringify(special)] as const,
      ),
    ].sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [path, text] of entries) {
      const top = path.split("/")[0] as string;
      const hash = parts.get(top) ?? createHash("sha1");
      parts.set(top, hash.update(`${path}\0${text}\0`));
    }
    return new Map(
      [...parts].map(([top, hash]) => [top, hash.digest("hex")] as const),
    );
  };
  // The issues and labels of each repo (slice 4.6, decision 020), kept so a test can read what the server did.
  const repos = new Map<string, { issues: FakeIssue[]; labels: Set<string> }>();
  const repoOf = (fullName: string) => {
    const known = repos.get(fullName);
    if (known) return known;
    const created = { issues: [] as FakeIssue[], labels: new Set<string>() };
    repos.set(fullName, created);
    return created;
  };
  // The repos that keep a Git history (decision 026): commits, trees and the default branch, changed by the code under test or by `push`.
  const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
  const gitRepos = new Map(
    Object.entries(initial.gitRepos ?? {}).map(([fullName, opts]) => {
      type Snap = {
        files: Record<string, string>;
        entries: Record<string, FakeGitEntry>;
      };
      const commits = new Map<
        string,
        Snap & { tree: string; parents: string[]; message: string }
      >();
      const trees = new Map<string, Snap>();
      let counter = 0;
      const addTree = (snap: Snap) => {
        const sha = sha1(
          JSON.stringify([
            Object.entries(snap.files).sort(),
            Object.entries(snap.entries).sort(),
          ]),
        );
        trees.set(sha, snap);
        return sha;
      };
      const addCommit = (snap: Snap, parents: string[], message: string) => {
        const tree = addTree(snap);
        const sha = sha1(
          `${fullName}\0${counter++}\0${tree}\0${parents}\0${message}`,
        );
        commits.set(sha, { ...snap, tree, parents, message });
        return sha;
      };
      /** `snap` with `path` set to `put`, GitHub's way: whatever was at the path, under it or as one of its parents is replaced. */
      const place = (snap: Snap, path: string, put: Partial<Snap>): Snap => {
        const clashes = (key: string) =>
          key === path ||
          key.startsWith(`${path}/`) ||
          path.startsWith(`${key}/`);
        const keep = <T>(record: Record<string, T>) =>
          Object.fromEntries(
            Object.entries(record).filter(([key]) => !clashes(key)),
          );
        return {
          files: { ...keep(snap.files), ...put.files },
          entries: { ...keep(snap.entries), ...put.entries },
        };
      };
      let current: string | null = opts.empty
        ? null
        : addCommit(
            { files: opts.files ?? {}, entries: opts.entries ?? {} },
            [],
            "initial commit",
          );
      let before: (() => void) | undefined;
      const otherBranches = new Map<string, string>();
      const git = {
        defaultBranch: opts.defaultBranch ?? "main",
        unreachable: opts.unreachable ?? false,
        refUpdateFailure: opts.refUpdateFailure,
        pullRequestFailure: opts.pullRequestFailure,
        /** The branches the code under test created (decision 026 G), in order of creation. */
        refsCreated: [] as { branch: string; sha: string; force: unknown }[],
        refsDeleted: [] as string[],
        pullRequests: [] as {
          number: number;
          head: string;
          base: string;
          title: string;
          body: string;
        }[],
        /** The sha a branch points at (the default branch included), `undefined` when it does not exist. */
        branch: (name: string) =>
          name === git.defaultBranch
            ? current === null
              ? undefined
              : current
            : otherBranches.get(name),
        _otherBranches: otherBranches,
        /** What the code under test sent. */
        created: {
          trees: [] as {
            baseTree: unknown;
            entries: {
              path: string;
              mode: string;
              type: string;
              content?: string;
              sha?: null;
            }[];
          }[],
          commits: [] as {
            sha: string;
            message: string;
            parents: string[];
            tree: string;
          }[],
          refUpdates: [] as { branch: string; sha: string; force: unknown }[],
        },
        /** The sha of the default branch. */
        get head() {
          if (current === null) throw new Error(`${fullName} has no commit`);
          return current;
        },
        commit: (sha: string) => commits.get(sha),
        /** The regular files (mode 100644) of a commit. */
        filesAt: (sha: string) => commits.get(sha)?.files,
        /** The other entries of a commit (executables, symlinks, submodules, files too large). */
        entriesAt: (sha: string) => commits.get(sha)?.entries,
        /** Another person's push on the default branch (files, then other entries, each replacing what is there); returns the new head. */
        push(
          files: Record<string, string>,
          message = "a push by someone else",
          entries: Record<string, FakeGitEntry> = {},
        ) {
          const parent = git.head;
          let snap = commits.get(parent) as Snap;
          for (const [path, text] of Object.entries(files))
            snap = place(snap, path, { files: { [path]: text } });
          for (const [path, entry] of Object.entries(entries))
            snap = place(snap, path, { entries: { [path]: entry } });
          current = addCommit(snap, [parent], message);
          return current;
        },
        beforeRefUpdate(fn: () => void) {
          before = fn;
        },
        // The stub's handlers of the git routes, below.
        _trees: trees,
        _commits: commits,
        _addTree: addTree,
        _addCommit: addCommit,
        _place: place,
        _runBefore() {
          const hook = before;
          before = undefined;
          hook?.();
        },
        _setHead(sha: string) {
          current = sha;
        },
        _head: () => current,
      };
      return [fullName, git] as const;
    }),
  );
  // Pull requests seeded by `addPull`, as `GET .../pulls/{n}` serves them (slice 7.3, decision 035 C).
  const pulls = new Map<string, unknown>();
  const unexpectedFetch = failOnUnexpectedFetch();
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw);
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const route = `${method} ${url.origin}${url.pathname}`;
      if (
        /^GET https:\/\/api\.github\.com\/users\/[^/]+\/installation$/.test(
          route,
        )
      ) {
        if (options.installationStatus)
          return Response.json(
            { message: "boom" },
            { status: options.installationStatus },
          );
        if (options.account === null)
          return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json({
          id: INSTALLATION_ID,
          account: { id: options.account, login: "whoever" },
        });
      }
      const tokenFor =
        /^POST https:\/\/api\.github\.com\/app\/installations\/(\d+)\/access_tokens$/.exec(
          route,
        );
      if (tokenFor && installations.includes(Number(tokenFor[1]))) {
        if (options.tokenStatus)
          return Response.json(
            { message: "boom" },
            { status: options.tokenStatus },
          );
        const id = Number(tokenFor[1]);
        return Response.json(
          {
            token: id === INSTALLATION_ID ? "ghs_x" : `ghs_${id}`,
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          },
          { status: 201 },
        );
      }
      if (route === "GET https://api.github.com/installation/repositories") {
        if (options.repositoriesStatus)
          return Response.json(
            { message: "boom" },
            { status: options.repositoriesStatus },
          );
        return Response.json({
          total_count: repositories.length,
          repositories,
        });
      }
      const gitRoute =
        /^(GET|POST|PATCH|DELETE) https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)((?:\/.*)?)$/.exec(
          route,
        );
      const git = gitRoute && gitRepos.get(gitRoute[2] as string);
      if (gitRoute && git) {
        const verb = gitRoute[1] as string;
        const rest = gitRoute[3] as string;
        const reply = (status: number, body: unknown) =>
          Response.json(body, { status });
        const sent = (() => {
          const raw = init?.body;
          return typeof raw === "string" && raw ? JSON.parse(raw) : {};
        })() as Record<string, unknown>;
        const failed = options.failOn?.({ method: verb, path: url.pathname });
        if (failed)
          return reply(failed === true ? 500 : failed, {
            message: "github-boom-message",
          });
        if (git.unreachable) return reply(404, { message: "Not Found" });
        const empty = git._head() === null;
        const sha = /^[0-9a-f]{40}$/;
        if (verb === "GET" && rest === "")
          return reply(200, {
            id: 1,
            full_name: gitRoute[2],
            default_branch: git.defaultBranch,
            private: false,
          });
        // Slice 7.2 (decision 034 C): the branches, in alphabetical order like GitHub, the default one included.
        if (verb === "GET" && rest === "/branches") {
          if (empty) return reply(200, []);
          return reply(
            200,
            [git.defaultBranch, ...git._otherBranches.keys()]
              .sort()
              .map((name) => ({ name })),
          );
        }
        const ref = /^\/git\/ref\/(.+)$/.exec(rest);
        if (verb === "GET" && ref) {
          if (empty) return reply(409, { message: "Git Repository is empty." });
          const wanted = decodeURIComponent(ref[1] as string);
          const at = wanted.startsWith("heads/")
            ? git.branch(wanted.slice("heads/".length))
            : undefined;
          if (at === undefined) return reply(404, { message: "Not Found" });
          return reply(200, {
            ref: `refs/${wanted}`,
            object: { sha: at, type: "commit" },
          });
        }
        const commitRoute = /^\/git\/commits\/(.+)$/.exec(rest);
        if (verb === "GET" && commitRoute) {
          const found = git.commit(commitRoute[1] as string);
          if (!found) return reply(404, { message: "Not Found" });
          return reply(200, {
            sha: commitRoute[1],
            tree: { sha: found.tree },
            parents: found.parents.map((parent) => ({ sha: parent })),
            message: found.message,
          });
        }
        const contents = /^\/contents\/(.+)$/.exec(rest);
        if (verb === "GET" && contents) {
          const at = url.searchParams.get("ref");
          if (!at || !sha.test(at))
            throw unexpectedFetch(`${route}${url.search}`);
          const path = decodeURIComponent(contents[1] as string);
          const atCommit = git.commit(at);
          const entry = atCommit?.entries[path];
          const text =
            atCommit?.files[path] ??
            (entry?.kind === "executable" ? entry.content : undefined);
          if (text !== undefined) return reply(200, contentsFile(path, text));
          if (entry?.kind === "large")
            return reply(200, {
              ...contentsFile(path, ""),
              size: 2_000_000,
              encoding: "none",
              content: "",
            });
          // A directory, a symlink or a submodule: only the tree tells them, the code under test must have read it.
          const under = [
            ...Object.keys(atCommit?.files ?? {}),
            ...Object.keys(atCommit?.entries ?? {}),
          ].some((key) => key.startsWith(`${path}/`));
          if (entry || under) throw unexpectedFetch(`${route}${url.search}`);
          return reply(404, { message: "Not Found" });
        }
        const treeRoute = /^\/git\/trees\/(.+)$/.exec(rest);
        if (verb === "GET" && treeRoute) {
          const wanted = /^([0-9a-f]{40})(?::(.*))?$/.exec(
            decodeURIComponent(treeRoute[1] as string),
          );
          if (!wanted || url.search !== "")
            throw unexpectedFetch(`${route}${url.search}`);
          const snap = git.commit(wanted[1] as string);
          const dir = wanted[2] ?? "";
          if (!snap) return reply(404, { message: "Not Found" });
          const all = { ...snap.files, ...snap.entries };
          if (dir in all) {
            const at = snap.entries[dir];
            if (at?.kind === "submodule" && at.treeStatus === 200)
              return reply(200, {
                sha: sha1(`${wanted[1]}:${dir}`),
                truncated: false,
                tree: [
                  {
                    path: "README.md",
                    mode: "100644",
                    type: "blob",
                    sha: sha1(`${dir}/README.md`),
                  },
                ],
              });
            return at?.kind === "submodule" && at.treeStatus === 404
              ? reply(404, { message: "Not Found" })
              : reply(422, { message: "not a tree" });
          }
          const prefix = dir === "" ? "" : `${dir}/`;
          const children = new Map<string, string>();
          for (const path of Object.keys(all))
            if (path.startsWith(prefix)) {
              const [name, ...more] = path.slice(prefix.length).split("/");
              children.set(name as string, more.length > 0 ? "" : path);
            }
          if (dir !== "" && children.size === 0)
            return reply(404, { message: "Not Found" });
          const kinds = {
            symlink: { mode: "120000", type: "blob" },
            submodule: { mode: "160000", type: "commit" },
            executable: { mode: "100755", type: "blob" },
            large: { mode: "100644", type: "blob" },
          };
          return reply(200, {
            sha: sha1(`${wanted[1]}:${dir}`),
            truncated: false,
            tree: [...children].map(([name, leaf]) => ({
              path: name,
              ...(leaf === ""
                ? { mode: "040000", type: "tree" }
                : (kinds[snap.entries[leaf]?.kind as keyof typeof kinds] ?? {
                    mode: "100644",
                    type: "blob",
                  })),
              sha: sha1(`${prefix}${name}:${wanted[1]}`),
            })),
          });
        }
        if (verb === "POST" && rest === "/git/trees") {
          const entries = Array.isArray(sent.tree) ? sent.tree : [];
          const base =
            typeof sent.base_tree === "string"
              ? git._trees.get(sent.base_tree)
              : undefined;
          const valid = entries.every(
            (e: Record<string, unknown>) =>
              typeof e.path === "string" &&
              e.mode === "100644" &&
              e.type === "blob" &&
              // `sha: null` removes the path (decision 030 E).
              (typeof e.content === "string" || e.sha === null),
          );
          if (!base || !valid)
            return reply(422, { message: "Validation Failed" });
          git.created.trees.push({ baseTree: sent.base_tree, entries });
          let snap = base;
          for (const e of entries)
            snap = git._place(
              snap,
              e.path,
              e.sha === null ? {} : { files: { [e.path]: e.content } },
            );
          const tree = git._addTree(snap);
          return reply(201, { sha: tree, truncated: false, tree: [] });
        }
        if (verb === "POST" && rest === "/git/commits") {
          const parents = Array.isArray(sent.parents) ? sent.parents : [];
          const snap =
            typeof sent.tree === "string"
              ? git._trees.get(sent.tree)
              : undefined;
          if (
            !snap ||
            typeof sent.message !== "string" ||
            !parents.every((p) => typeof p === "string" && git.commit(p))
          )
            return reply(422, { message: "Validation Failed" });
          const created = git._addCommit(snap, parents, sent.message);
          git.created.commits.push({
            sha: created,
            message: sent.message,
            parents,
            tree: sent.tree as string,
          });
          return reply(201, {
            sha: created,
            tree: { sha: sent.tree },
            parents: parents.map((parent) => ({ sha: parent })),
            message: sent.message,
          });
        }
        const refs = /^\/git\/refs\/(.+)$/.exec(rest);
        if (verb === "PATCH" && refs) {
          git._runBefore();
          const name = decodeURIComponent(refs[1] as string);
          git.created.refUpdates.push({
            branch: name.replace(/^heads\//, ""),
            sha: String(sent.sha),
            force: sent.force,
          });
          if (name !== `heads/${git.defaultBranch}` || empty)
            return reply(422, { message: "Reference does not exist" });
          if (typeof sent.sha !== "string" || !git.commit(sent.sha))
            return reply(422, { message: "Object does not exist" });
          if (git.refUpdateFailure)
            return reply(git.refUpdateFailure.status, {
              message: git.refUpdateFailure.message,
            });
          // Fast forward: the current head is the new commit or one of its ancestors.
          const seen = new Set<string>();
          const todo = [sent.sha];
          while (todo.length > 0) {
            const next = todo.pop() as string;
            if (seen.has(next)) continue;
            seen.add(next);
            todo.push(...(git.commit(next)?.parents ?? []));
          }
          if (sent.force !== true && !seen.has(git.head))
            return reply(422, { message: "Update is not a fast forward" });
          git._setHead(sent.sha);
          return reply(200, {
            ref: `refs/${name}`,
            object: { sha: sent.sha, type: "commit" },
          });
        }
        if (verb === "POST" && rest === "/git/refs") {
          const branch = /^refs\/heads\/(.+)$/.exec(String(sent.ref))?.[1];
          git.refsCreated.push({
            branch: branch ?? String(sent.ref),
            sha: String(sent.sha),
            force: sent.force,
          });
          if (!branch || typeof sent.sha !== "string" || !git.commit(sent.sha))
            return reply(422, { message: "Object does not exist" });
          if (git.branch(branch) !== undefined)
            return reply(422, { message: "Reference already exists" });
          git._otherBranches.set(branch, sent.sha);
          return reply(201, {
            ref: sent.ref,
            object: { sha: sent.sha, type: "commit" },
          });
        }
        const deleted = /^\/git\/refs\/heads\/(.+)$/.exec(rest);
        if (verb === "DELETE" && deleted) {
          const branch = decodeURIComponent(deleted[1] as string);
          git.refsDeleted.push(branch);
          if (!git._otherBranches.delete(branch))
            return reply(422, { message: "Reference does not exist" });
          return new Response(null, { status: 204 });
        }
        if (verb === "POST" && rest === "/pulls") {
          if (git.pullRequestFailure)
            return reply(git.pullRequestFailure.status, {
              message: git.pullRequestFailure.message,
            });
          if (
            typeof sent.title !== "string" ||
            typeof sent.head !== "string" ||
            !git._otherBranches.has(sent.head) ||
            sent.base !== git.defaultBranch
          )
            return reply(422, { message: "Validation Failed" });
          const number = git.pullRequests.length + 1;
          git.pullRequests.push({
            number,
            head: sent.head,
            base: sent.base,
            title: sent.title,
            body: typeof sent.body === "string" ? sent.body : "",
          });
          return reply(201, {
            number,
            html_url: `https://github.com/${gitRoute[2]}/pull/${number}`,
          });
        }
        throw unexpectedFetch(route);
      }
      const repoRoute =
        /^GET https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)(?:\/contents\/(.+)|\/git\/trees\/(.+))$/.exec(
          route,
        );
      if (repoRoute) {
        const [, fullName, encodedPath, encodedTreeish] = repoRoute;
        const live = viewOf(fullName as string);
        const snapshotOf = (sha: string) => snapshots.get(`${fullName}@${sha}`);
        const notFound = () =>
          Response.json({ message: "Not Found" }, { status: 404 });
        if (options.networkError) throw new TypeError("fetch failed");
        if (encodedTreeish !== undefined) {
          const treeish = decodeURIComponent(encodedTreeish);
          const recursive = url.searchParams.get("recursive") === "1";
          // Only the root (HEAD, not recursive) and a directory pinned to a commit sha (<sha>:<dir>, either way) exist:
          // a recursive read of the whole repo is what the health check must never do, and `HEAD:<dir>` is not pinned.
          const pinned = /^([0-9a-f]{40}):(.+)$/.exec(treeish);
          const isRoot = treeish === "HEAD";
          if (
            (!isRoot && !pinned) ||
            (isRoot && url.search !== "") ||
            (!isRoot && url.search !== "" && !recursive)
          )
            throw unexpectedFetch(`${route}${url.search}`);
          const dir = pinned?.[2] ?? "";
          // The options name a sub-read `HEAD:<dir>`, whatever commit sha pins it.
          const optionKey = isRoot ? "HEAD" : `HEAD:${dir}`;
          const status =
            typeof options.treesStatus === "object"
              ? options.treesStatus[optionKey]
              : options.treesStatus;
          if (status) return Response.json({ message: "boom" }, { status });
          if (options.emptyRepo && isRoot)
            return Response.json(
              { message: "Git Repository is empty." },
              { status: 409 },
            );
          // A commit sha the stub never served is unknown to GitHub too: 404.
          const { files, specials, all } = isRoot
            ? live
            : (snapshotOf((pinned as RegExpExecArray)[1] as string) ?? {
                files: undefined,
              });
          if (!files || !all || !specials) return notFound();
          // GitHub answers 422 when the path is a file or a symlink (verified); a submodule is assumed to answer 422 too. 404 is for a path that does not exist.
          if (dir && !all.has(dir)) return notFound();
          if (dir && all.get(dir)?.type !== "tree")
            return Response.json(
              {
                message:
                  "Invalid object requested. SHA must identify a commit or a tree.",
              },
              { status: 422 },
            );
          const truncated =
            recursive && options.treesTruncated?.[optionKey] === true;
          const prefix = dir ? `${dir}/` : "";
          const shas = dir ? undefined : rootShas(files, specials);
          // The root's identity: the sha of the commit (derived from the content, so a push changes it), and the ETag GitHub derives from it.
          const commitSha = createHash("sha1")
            .update(JSON.stringify([...(shas ?? [])]))
            .digest("hex");
          const etag = `W/"${createHash("sha1").update(`${commitSha}:${etagSalt}`).digest("hex")}"`;
          if (isRoot && headers.get("if-none-match") === etag)
            return new Response(null, { status: 304, headers: { etag } });
          // A truncated recursive answer is cut short: here it holds nothing.
          const tree = truncated
            ? []
            : [...all]
                .filter(
                  ([path]) =>
                    path.startsWith(prefix) &&
                    (recursive || !path.includes("/", prefix.length)),
                )
                .map(([path, { mode, type }]) => ({
                  path: path.slice(prefix.length),
                  mode,
                  type,
                  sha: shas?.get(path) ?? "abc123",
                }));
          const answer = Response.json(
            {
              sha: dir ? "def456" : commitSha,
              url: `https://api.github.com/repos/${fullName}/git/trees/${dir ? "def456" : commitSha}`,
              truncated,
              tree,
            },
            dir ? undefined : { headers: { etag } },
          );
          if (isRoot) {
            snapshots.set(`${fullName}@${commitSha}`, live);
            served.push(commitSha);
            const hook = afterRoot;
            afterRoot = undefined;
            hook?.();
          }
          return answer;
        }
        const path = decodeURIComponent(encodedPath as string);
        const failure = options.contentsStatus?.[path];
        if (failure)
          return Response.json({ message: "boom" }, { status: failure });
        // The Contents API is pinned to a commit like the trees; an unpinned read is a bug of the caller.
        const ref = url.searchParams.get("ref");
        if (!ref || !/^[0-9a-f]{40}$/.test(ref))
          throw unexpectedFetch(`${route}${url.search}`);
        const pinnedView = snapshotOf(ref);
        const special = pinnedView?.specials[path];
        if (special)
          return Response.json({
            ...special,
            name: path.split("/").pop(),
            path,
            sha: "abc123",
            size: 0,
          });
        const file = pinnedView?.files[path];
        if (file === undefined) throw unexpectedFetch(`${route}${url.search}`);
        return Response.json(contentsFile(path, file));
      }
      if (/^(GET|PATCH) https:\/\/api\.github\.com\/app\/hook\//.test(route)) {
        // Only the App itself (a JWT) may read or write its webhook.
        if (!/^bearer eyJ/i.test(headers.get("authorization") ?? ""))
          return Response.json({ message: "Bad credentials" }, { status: 401 });
        const boom = (status: number | undefined) =>
          status
            ? Response.json({ message: "github-boom-message" }, { status })
            : undefined;
        const config = () =>
          Response.json({
            content_type: "json",
            insecure_ssl: "0",
            url: webhook.url,
            ...(webhook.active !== undefined && { active: webhook.active }),
          });
        if (route === "GET https://api.github.com/app/hook/config")
          return boom(webhook.configStatus) ?? config();
        if (route === "GET https://api.github.com/app/hook/deliveries") {
          const failure = boom(webhook.deliveriesStatus);
          if (failure) return failure;
          const perPage = Number(url.searchParams.get("per_page") ?? 30);
          return Response.json(
            webhook.deliveries.slice(0, perPage).map((d, i) => ({
              id: 1000 - i,
              guid: `guid-${i}`,
              event: "push",
              action: null,
              ...d,
            })),
          );
        }
      }
      const pullRoute =
        /^GET https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(
          route,
        );
      if (pullRoute) {
        const failed = options.failOn?.({ method, path: url.pathname });
        if (failed)
          return Response.json(
            { message: "github-boom-message" },
            { status: failed === true ? 500 : failed },
          );
        const pull = pulls.get(`${pullRoute[1]}#${pullRoute[2]}`);
        if (!pull)
          return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json(pull);
      }
      const issueRoute =
        /^(GET|POST|PATCH|DELETE) https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/(?:(labels)|issues(?:\/(\d+)(?:\/(labels)(?:\/(.+))?)?)?)$/.exec(
          route,
        );
      if (issueRoute) {
        const [, verb, fullName, repoLabels, rawNumber, issueLabels, rawName] =
          issueRoute;
        const repo = repoOf(fullName as string);
        const sent = (() => {
          const raw = init?.body;
          return typeof raw === "string" && raw ? JSON.parse(raw) : {};
        })() as Record<string, unknown>;
        const reply = (status: number, body: unknown) =>
          Response.json(body, { status });
        if (options.issuesDelay)
          await new Promise((resolve) =>
            setTimeout(resolve, options.issuesDelay),
          );
        if (options.issuesStatus)
          return reply(options.issuesStatus, {
            message: "github-boom-message",
          });
        const failed = options.failOn?.({
          method: verb as string,
          path: url.pathname,
        });
        if (failed)
          return reply(failed === true ? 500 : failed, {
            message: "github-boom-message",
          });
        // GitHub's limits, in characters (here UTF-16 units).
        const tooLong = () =>
          (typeof sent.title === "string" && sent.title.length > 256) ||
          (typeof sent.body === "string" && sent.body.length > 65_536)
            ? reply(422, {
                message: "Validation Failed",
                errors: [{ resource: "Issue", code: "custom" }],
              })
            : undefined;
        const labelNames = () =>
          Array.isArray(sent.labels)
            ? (sent.labels as unknown[]).map((l) =>
                typeof l === "string"
                  ? l
                  : String((l as { name?: unknown }).name),
              )
            : [];
        // GitHub creates unknown labels on its own when an issue is created with them; this fake is stricter on purpose, so the "create the label first" path is exercised.
        const unknown = (names: string[]) =>
          names.find((name) => !repo.labels.has(name));
        const missing = (name: string) =>
          reply(422, {
            message: "Validation Failed",
            errors: [{ resource: "Label", code: "invalid", value: name }],
          });
        if (repoLabels && verb === "POST") {
          const name = String(sent.name ?? "");
          if (!name || repo.labels.has(name))
            return reply(422, {
              message: "Validation Failed",
              errors: [{ resource: "Label", code: "already_exists" }],
            });
          repo.labels.add(name);
          return reply(201, { name });
        }
        if (!repoLabels && rawNumber === undefined && verb === "POST") {
          const names = labelNames();
          const absent = unknown(names);
          if (absent !== undefined) return missing(absent);
          const refused = tooLong();
          if (refused) return refused;
          const number = repo.issues.length + 1;
          const issue: FakeIssue = {
            number,
            title: String(sent.title ?? ""),
            body: String(sent.body ?? ""),
            labels: names,
            state: "open",
            stateReason: null,
            html_url: `https://github.com/${fullName}/issues/${number}`,
          };
          repo.issues.push(issue);
          return reply(201, serve(issue));
        }
        const issue = repo.issues.find((i) => i.number === Number(rawNumber));
        if (rawNumber !== undefined && !issue)
          return reply(404, { message: "Not Found" });
        if (issue && !issueLabels && verb === "PATCH") {
          const refused = tooLong();
          if (refused) return refused;
          if (typeof sent.title === "string") issue.title = sent.title;
          if (typeof sent.body === "string") issue.body = sent.body;
          if (sent.state === "open" || sent.state === "closed")
            issue.state = sent.state;
          if (sent.state === "open") issue.stateReason = null;
          else if (typeof sent.state_reason === "string")
            issue.stateReason = sent.state_reason;
          if (Array.isArray(sent.labels)) issue.labels = labelNames();
          return reply(200, serve(issue));
        }
        if (issue && issueLabels && !rawName && verb === "POST") {
          const names = labelNames();
          const absent = unknown(names);
          if (absent !== undefined) return missing(absent);
          issue.labels = [...new Set([...issue.labels, ...names])];
          return reply(
            200,
            issue.labels.map((name) => ({ name })),
          );
        }
        if (issue && issueLabels && rawName && verb === "DELETE") {
          const name = decodeURIComponent(rawName);
          if (!issue.labels.includes(name))
            return reply(404, { message: "Label does not exist" });
          issue.labels = issue.labels.filter((l) => l !== name);
          return reply(
            200,
            issue.labels.map((l) => ({ name: l })),
          );
        }
      }
      throw unexpectedFetch(route);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return Object.assign(fetchMock, {
    /** The App's webhook as GitHub holds it now (live object: assign its fields to change it between two calls). */
    webhook,
    /** The issues of a repo, as GitHub holds them now (live objects: read them after the call under test). */
    issues: (fullName: string) => repoOf(fullName).issues,
    /** The names of the labels that exist in a repo. */
    labels: (fullName: string) => [...repoOf(fullName).labels],
    /** Makes a label exist in a repo, as a person would have created it. */
    addLabel(fullName: string, name: string) {
      repoOf(fullName).labels.add(name);
    },
    /** Puts a label (created in the repo if needed) on an issue, as a person would (the label `bug`). */
    addIssueLabel(fullName: string, number: number, name: string) {
      const repo = repoOf(fullName);
      repo.labels.add(name);
      repo.issues.find((i) => i.number === number)?.labels.push(name);
    },
    /** Makes `GET /repos/{fullName}/pulls/{number}` answer a PR whose head is `branch`, from `headRepo` (default: the same repo, so not a fork); any other number is 404. */
    addPull(
      fullName: string,
      number: number,
      branch: string,
      headRepo = fullName,
    ) {
      pulls.set(`${fullName}#${number}`, {
        number,
        state: "open",
        html_url: `https://github.com/${fullName}/pull/${number}`,
        head: { ref: branch, repo: { full_name: headRepo } },
        base: { ref: "main", repo: { full_name: fullName } },
      });
    },
    /** The live Git state of a repo named in `gitRepos` (decision 026), see the stub's comment. */
    git(fullName: string) {
      const git = gitRepos.get(fullName);
      if (!git) throw new Error(`${fullName} is not in gitRepos`);
      return git;
    },
    /** The commit sha of each root answer 200, in order. */
    served,
    update(patch: Partial<typeof initial>) {
      Object.assign(options, patch);
      views = new Map();
    },
    rotateEtag() {
      etagSalt++;
    },
    afterNextRoot(fn: () => void) {
      afterRoot = fn;
    },
  });
}

/** What the server asked of GitHub: method, path, query string and Authorization header of each call. */
export function githubCalls(fetchMock: ReturnType<typeof stubGitHub>) {
  return fetchMock.mock.calls.map(([input, init]) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    return {
      method: (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase(),
      path: new URL(raw).pathname,
      search: new URL(raw).search,
      authorization: headers.get("authorization") ?? "",
      ifNoneMatch: headers.get("if-none-match") ?? "",
    };
  });
}

/** The calls that touch the issues or the labels of a repo (slice 4.6): "the server did not write to GitHub" is `toEqual([])` on this. */
export function issueCalls(fetchMock: ReturnType<typeof stubGitHub>) {
  return githubCalls(fetchMock).filter((call) =>
    /^\/repos\/[^/]+\/[^/]+\/(issues|labels)(\/|$)/.test(call.path),
  );
}
