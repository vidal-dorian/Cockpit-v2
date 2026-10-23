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

/**
 * Stubs the global fetch with the three GitHub endpoints the import uses
 * (decision 011); any other call fails loudly. `account` is the GitHub id of the
 * installation's account, or null for "the App is not installed" (404).
 */
export function stubGitHub(options: {
  account: number | null;
  repositories?: GitHubRepo[];
  installationStatus?: number;
  repositoriesStatus?: number;
}) {
  const repositories = options.repositories ?? [];
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
      if (
        route ===
        `POST https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`
      ) {
        return Response.json(
          {
            token: "ghs_x",
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
      throw new Error(`Unexpected fetch ${route}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** What the server asked of GitHub: method, path and Authorization header of each call. */
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
      authorization: headers.get("authorization") ?? "",
    };
  });
}
