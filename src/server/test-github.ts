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

/** The address of the App's webhook the stub starts with: the one of `configureTestInstance` (decision 024 F). */
export const DEFAULT_WEBHOOK_URL =
  "https://cockpit.example.com/api/webhooks/github";

/** The App's webhook as the stub holds it (decision 024 F, G); read and change it between two calls. */
export type FakeWebhook = {
  url: string;
  /** Sent in the answer of `GET /app/hook/config` only when set. */
  active?: boolean;
  /** Newest first, as GitHub lists them. */
  deliveries: { status_code: number }[];
  /** Fails the given call with that status (body message `github-boom-message`). */
  configStatus?: number;
  deliveriesStatus?: number;
  patchStatus?: number;
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
 * with 500 every call it returns true for, to break one step of a sync (`(c) => c.method === "PATCH"`); set or clear them with `update(...)`.
 * Like GitHub, an issue created or patched with a title over 256 characters or a body over 65,536 is refused with 422.
 *
 * The webhook of the App (decisions 002 and 024), read and written as the App itself (a JWT, never an installation token: 401 otherwise):
 * `GET /app/hook/config` (`{ url, content_type, insecure_ssl }`, plus `active` when the test set it), `GET /app/hook/deliveries?per_page=n` (the `n` newest
 * deliveries, each `{ id, guid, status_code, event, action }`) and `PATCH /app/hook/config` (`{ url }`, which changes the url the next read answers).
 * It starts at DEFAULT_WEBHOOK_URL with no delivery, so a health check reads it green. The returned mock holds it as `webhook` (a live object: assign
 * its fields between two calls, `initial.webhook` seeds them); `configStatus`, `deliveriesStatus` and `patchStatus` fail one of the three calls.
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
  failOn?: (call: { method: string; path: string }) => boolean;
  webhook?: Partial<FakeWebhook>;
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
        if (route === "PATCH https://api.github.com/app/hook/config") {
          const failure = boom(webhook.patchStatus);
          if (failure) return failure;
          const sent = JSON.parse(String(init?.body ?? "{}")) as {
            url?: string;
          };
          if (typeof sent.url === "string") webhook.url = sent.url;
          return config();
        }
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
        if (options.failOn?.({ method: verb as string, path: url.pathname }))
          return reply(500, { message: "github-boom-message" });
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
