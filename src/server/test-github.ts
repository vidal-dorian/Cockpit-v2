import { createHash, generateKeyPairSync } from "node:crypto";
import { vi } from "vitest";

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
 * Stubs the global fetch with the GitHub endpoints the server uses
 * (decisions 011 and 002); any other call fails loudly. `account` is the GitHub id of the
 * installation's account, or null for "the App is not installed" (404).
 *
 * The health check (slice 2.2) reads a repo through small directories only (decision 013):
 * - `files` maps a path of the repo to its text (`repoFiles`: the same per `owner/repo`, for the repos it names; `files` serves the others). `GET /repos/{o}/{r}/git/trees/{treeish}` serves
 *   `HEAD` (the root, not recursive; its `sha` is a COMMIT sha) and `<commit sha>:<dir>` (not recursive,
 *   or `?recursive=1`; paths relative to the dir; 404 when nothing is there, 422 when it is a file, a symlink or a submodule), as blobs (mode 100644) plus trees.
 *   Anything else fails loudly with "Unexpected fetch": `HEAD?recursive=1` (the whole repo) and
 *   `HEAD:<dir>` (a sub-read that is not pinned to the commit the root returned).
 *   The Contents API (`?ref=<commit sha>` is required, a call without it fails loudly) serves a file as a file, a path with files under it as a directory (array),
 *   any other path as 404.
 *   The stub keeps a snapshot of the repo for every commit sha it served on the root, and answers the
 *   pinned reads from that snapshot, whatever the repo became since. A sha it never served is 404 (trees and Contents).
 *   The options `treesStatus` / `treesTruncated` keep naming the sub-reads `HEAD:<dir>`, whatever sha pins them.
 * - `specials` serves a path as something other than a file or a directory: a
 *   submodule (tree entry `type: "commit"`, mode 160000) or a symlink (blob, mode 120000),
 *   and the Contents API describes them as such.
 * - `treesStatus` fails the trees route with that status, for every tree-ish or only the given
 *   ones (`{ "HEAD:.claude": 500 }`); `treesTruncated` does the same with `truncated: true` on a
 *   recursive answer, which then holds no entry (GitHub cuts it short); `emptyRepo` answers what
 *   GitHub answers for a repo without commit: 409 "Git Repository is empty." on the trees route.
 * - `contentsStatus` fails every Contents call with that status, or only the given
 *   paths with theirs; `networkError` makes every trees and Contents call throw.
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
 */
export function stubGitHub(initial: {
  account: number | null;
  repositories?: GitHubRepo[];
  installationStatus?: number;
  repositoriesStatus?: number;
  files?: Record<string, string>;
  repoFiles?: Record<string, Record<string, string>>;
  contentsStatus?: number | Record<string, number>;
  specials?: Record<
    string,
    { type: "submodule" } | { type: "symlink"; target: string }
  >;
  networkError?: boolean;
  treesStatus?: number | Record<string, number>;
  treesTruncated?: boolean | Record<string, boolean>;
  emptyRepo?: boolean;
  tokenStatus?: number;
  installations?: number[];
}) {
  // Mutable on purpose: `update` changes it between two calls.
  const options = { ...initial };
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
            throw new Error(`Unexpected fetch ${route}${url.search}`);
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
            recursive &&
            (typeof options.treesTruncated === "object"
              ? options.treesTruncated[optionKey]
              : options.treesTruncated) === true;
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
        const path = decodeURIComponent(encodedPath as string).replace(
          /\/$/,
          "",
        );
        const failure =
          typeof options.contentsStatus === "number"
            ? options.contentsStatus
            : options.contentsStatus?.[path];
        if (failure)
          return Response.json({ message: "boom" }, { status: failure });
        // The Contents API is pinned to a commit like the trees; an unpinned read is a bug of the caller.
        const ref = url.searchParams.get("ref");
        if (!ref || !/^[0-9a-f]{40}$/.test(ref))
          throw new Error(`Unexpected fetch ${route}${url.search}`);
        const pinnedView = snapshotOf(ref);
        if (!pinnedView) return notFound();
        const files = pinnedView.files;
        const special = pinnedView.specials[path];
        if (special)
          return Response.json({
            ...special,
            name: path.split("/").pop(),
            path,
            sha: "abc123",
            size: 0,
          });
        const file = files[path];
        if (file !== undefined) return Response.json(contentsFile(path, file));
        const children = new Map<string, "file" | "dir">();
        for (const key of Object.keys(files)) {
          if (!key.startsWith(`${path}/`)) continue;
          const rest = key.slice(path.length + 1).split("/");
          if (rest[0]) children.set(rest[0], rest.length > 1 ? "dir" : "file");
        }
        if (children.size === 0) return notFound();
        return Response.json(
          [...children].map(([name, type]) => ({
            name,
            path: `${path}/${name}`,
            type,
            sha: "abc123",
          })),
        );
      }
      throw new Error(`Unexpected fetch ${route}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return Object.assign(fetchMock, {
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
