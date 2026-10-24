import { generateKeyPairSync } from "node:crypto";
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
 * - `files` maps a path of the repo to its text. `GET /repos/{o}/{r}/git/trees/{treeish}` serves
 *   `HEAD` (the root, not recursive) and `HEAD:<dir>` (not recursive, or `?recursive=1`; paths
 *   relative to the dir; 404 when nothing is there, 422 when it is a file, a symlink or a submodule), as blobs (mode 100644) plus trees.
 *   Anything else, e.g. `HEAD?recursive=1` (the whole repo), fails loudly with "Unexpected fetch".
 *   The Contents API serves a file as a file, a path with files under it as a directory (array),
 *   any other path as 404.
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
 */
export function stubGitHub(options: {
  account: number | null;
  repositories?: GitHubRepo[];
  installationStatus?: number;
  repositoriesStatus?: number;
  files?: Record<string, string>;
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
  const files = options.emptyRepo ? {} : (options.files ?? {});
  const installations = options.installations ?? [INSTALLATION_ID];
  const repositories = options.repositories ?? [];
  // Every path of the repo with its tree entry, directories included; built once, a test may hold 150,000 files.
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
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(raw);
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
        const notFound = () =>
          Response.json({ message: "Not Found" }, { status: 404 });
        if (options.networkError) throw new TypeError("fetch failed");
        if (encodedTreeish !== undefined) {
          const treeish = decodeURIComponent(encodedTreeish);
          const recursive = url.searchParams.get("recursive") === "1";
          // Only the root (HEAD, not recursive) and a directory (HEAD:<dir>, either way) exist:
          // a recursive read of the whole repo is what the health check must never do.
          const dir = treeish.startsWith("HEAD:") ? treeish.slice(5) : "";
          if (
            (treeish !== "HEAD" && !dir) ||
            (treeish === "HEAD" && url.search !== "") ||
            (treeish !== "HEAD" && url.search !== "" && !recursive)
          )
            throw new Error(`Unexpected fetch ${route}${url.search}`);
          const status =
            typeof options.treesStatus === "object"
              ? options.treesStatus[treeish]
              : options.treesStatus;
          if (status) return Response.json({ message: "boom" }, { status });
          if (options.emptyRepo)
            return Response.json(
              { message: "Git Repository is empty." },
              { status: 409 },
            );
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
              ? options.treesTruncated[treeish]
              : options.treesTruncated) === true;
          const prefix = dir ? `${dir}/` : "";
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
                  sha: "abc123",
                }));
          return Response.json({
            sha: "def456",
            url: `https://api.github.com/repos/${fullName}/git/trees/def456`,
            truncated,
            tree,
          });
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
        const special = options.specials?.[path];
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
  return fetchMock;
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
    };
  });
}
