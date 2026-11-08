import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_PERMISSIONS,
  BASE_PERMISSIONS,
  githubCalls,
  INSTALLATION_ID,
  installationUrl,
} from "./test-github.ts";
import { withProject } from "./test-mcp.ts";

// Slice R6 (decision 052 B, L): the sixth and seventh lines of the health check, `github_alerts` and `updates`.
//
// Pinned where the decision leaves it open (the developer follows these; the web tests of src/web/ProjectPageAlerts.test.tsx use the same):
// - The order of the lines is claude_md, ci, mcp, agents, [catalog], webhook, github_alerts, updates (the catalog line only for a prepared repo, as before).
// - `github_alerts` is `{ key: "github_alerts", ok: true, detail: "ok" }` when the App and the installation both have dependabot_alerts, security_events and secret_scanning_alerts
//   (read or write). Red, it is `{ key, ok: false, detail, url }`:
//   `app_missing_permissions` with `url` the permissions page of the App (`https://github.com/settings/apps/<slug>/permissions`) when `GET /app` lacks one of the three;
//   `installation_not_approved` with `url` the `html_url` of `GET /app/installations/{id}` when the App has the three and the installation lacks one;
//   `unknown` with no `url` when one of the two reads fails (the other lines are still computed). If the App lacks a permission, that wins over the installation.
//   An `ok` line has no `url` key.
// - Both reads are made as the App (a JWT), on each display (the per-commit cache of 013 G covers the files of the repo, not this line, like the webhook line of 024 F), in
//   parallel: one `GET /app` and one `GET /app/installations/<project.installationId>`.
// - `updates` is `{ key: "updates", ok: true, detail: "ok" }` or `{ key: "updates", ok: false, detail: "missing" }`: ok when `.github/dependabot.yml` or `.github/dependabot.yaml` exists
//   (a file), or a Renovate file: `renovate.json`, `renovate.json5`, `.renovaterc`, `.renovaterc.json` at the root, `renovate.json` or `renovate.json5` in `.github`.
//   It comes from the files of the repo, so it is part of the per-commit cache. `.github` (not recursive) is read in the same wave as `.github/workflows`, only when the root lists it as a directory.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Line = { key: string; ok: boolean; detail: string; url?: string };

async function lines(files: Record<string, string>, stub = {}) {
  const ctx = await withProject({ files, ...stub });
  const health = async () => {
    const res = await ctx.app.request(`/api/projects/${ctx.projectId}/health`, {
      headers: { cookie: ctx.alice.cookie },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { lines: Line[] }).lines;
  };
  return { ...ctx, health };
}
const lineOf = (all: Line[], key: string) => all.find((l) => l.key === key);
const without = (...names: string[]) =>
  Object.fromEntries(
    Object.entries({ ...BASE_PERMISSIONS, ...ALERT_PERMISSIONS }).filter(
      ([name]) => !names.includes(name),
    ),
  );
const appCalls = (fetchMock: Parameters<typeof githubCalls>[0]) =>
  githubCalls(fetchMock).filter(
    (c) =>
      c.path === "/app" || c.path === `/app/installations/${INSTALLATION_ID}`,
  );

describe("decision 052 B: the line « Alertes GitHub »", () => {
  it("given an empty repo, when the health is read, then the lines end with webhook, github_alerts and updates, in that order", async () => {
    const { health } = await lines({});

    expect((await health()).map((l) => l.key)).toEqual([
      "claude_md",
      "ci",
      "mcp",
      "agents",
      "webhook",
      "github_alerts",
      "updates",
    ]);
  });

  it("given an App and an installation that have the three alert permissions, when the health is read, then github_alerts is ok with no url", async () => {
    const { health } = await lines({});

    expect(lineOf(await health(), "github_alerts")).toEqual({
      key: "github_alerts",
      ok: true,
      detail: "ok",
    });
  });

  it("given the alert permissions granted in write, when the health is read, then github_alerts is ok", async () => {
    const write = Object.fromEntries(
      Object.keys(ALERT_PERMISSIONS).map((k) => [k, "write"]),
    );
    const { health } = await lines(
      {},
      {
        appInfo: { permissions: { ...BASE_PERMISSIONS, ...write } },
        installationInfo: { permissions: { ...BASE_PERMISSIONS, ...write } },
      },
    );

    expect(lineOf(await health(), "github_alerts")?.ok).toBe(true);
  });

  it.each(Object.keys(ALERT_PERMISSIONS))(
    "given an App that does not ask for %s, when the health is read, then github_alerts is red app_missing_permissions with the permissions page of the App",
    async (permission) => {
      const { health } = await lines(
        {},
        { appInfo: { permissions: without(permission) } },
      );

      expect(lineOf(await health(), "github_alerts")).toEqual({
        key: "github_alerts",
        ok: false,
        detail: "app_missing_permissions",
        url: "https://github.com/settings/apps/cockpit-test/permissions",
      });
    },
  );

  it.each(Object.keys(ALERT_PERMISSIONS))(
    "given an App that asks for the three but an installation that lacks %s, when the health is read, then github_alerts is red installation_not_approved with the html_url of the installation",
    async (permission) => {
      const { health } = await lines(
        {},
        { installationInfo: { permissions: without(permission) } },
      );

      expect(lineOf(await health(), "github_alerts")).toEqual({
        key: "github_alerts",
        ok: false,
        detail: "installation_not_approved",
        url: installationUrl(),
      });
    },
  );

  it("given an App and an installation that both lack a permission, when the health is read, then the App is blamed first: app_missing_permissions", async () => {
    const { health } = await lines(
      {},
      {
        appInfo: { permissions: without("security_events") },
        installationInfo: { permissions: without("secret_scanning_alerts") },
      },
    );

    expect(lineOf(await health(), "github_alerts")?.detail).toBe(
      "app_missing_permissions",
    );
  });

  it.each([
    ["GET /app", { appInfo: { status: 500 } }],
    ["the installation", { installationInfo: { status: 500 } }],
    ["both", { appInfo: { status: 502 }, installationInfo: { status: 500 } }],
  ])(
    "given GitHub fails on %s, when the health is read, then 200 with github_alerts red unknown and no url, and the other lines still computed",
    async (_name, stub) => {
      const { health } = await lines({ "CLAUDE.md": "# x" }, stub);

      const all = await health();

      expect(lineOf(all, "github_alerts")).toEqual({
        key: "github_alerts",
        ok: false,
        detail: "unknown",
      });
      expect(lineOf(all, "claude_md")?.ok).toBe(true);
      expect(lineOf(all, "webhook")?.ok).toBe(true);
    },
  );

  it("given a health display, when GitHub is asked, then GET /app and GET /app/installations/<id> are each read once as the App (a JWT)", async () => {
    const { health, fetchMock } = await lines({});

    await health();

    const calls = appCalls(fetchMock).filter((c) => c.method === "GET");
    expect(calls.map((c) => c.path).sort()).toEqual([
      "/app",
      `/app/installations/${INSTALLATION_ID}`,
    ]);
    for (const call of calls)
      expect(call.authorization).toMatch(/^bearer eyJ/i);
  });

  it("given a repo whose HEAD did not change (304 on the root), when the permissions change on GitHub, then the next display shows the new state: the line is not part of the per-commit cache", async () => {
    const { health, fetchMock } = await lines({ "CLAUDE.md": "# x" });
    expect(lineOf(await health(), "github_alerts")?.ok).toBe(true);

    fetchMock.update({
      installationInfo: { permissions: without("dependabot_alerts") },
    });

    expect(lineOf(await health(), "github_alerts")).toMatchObject({
      ok: false,
      detail: "installation_not_approved",
    });
    expect(fetchMock.served).toHaveLength(1);
  });

  it("given a project that is not the caller's, when the health is requested, then 404 and the permissions are not read", async () => {
    const ctx = await lines({});

    const res = await ctx.app.request("/api/projects/99999/health", {
      headers: { cookie: ctx.alice.cookie },
    });

    expect(res.status).toBe(404);
    expect(appCalls(ctx.fetchMock).filter((c) => c.method === "GET")).toEqual(
      [],
    );
  });
});

describe("decision 052 L: the line « Mises à jour automatiques »", () => {
  it.each([
    ["dependabot.yml", { ".github/dependabot.yml": "version: 2\n" }],
    ["dependabot.yaml", { ".github/dependabot.yaml": "version: 2\n" }],
    ["renovate.json at the root", { "renovate.json": "{}" }],
    ["renovate.json5 at the root", { "renovate.json5": "{}" }],
    [".renovaterc at the root", { ".renovaterc": "{}" }],
    [".renovaterc.json at the root", { ".renovaterc.json": "{}" }],
    ["renovate.json in .github", { ".github/renovate.json": "{}" }],
    ["renovate.json5 in .github", { ".github/renovate.json5": "{}" }],
  ])(
    "given a repo with %s, when the health is read, then updates is ok",
    async (_name, files) => {
      const { health } = await lines(files);

      expect(lineOf(await health(), "updates")).toEqual({
        key: "updates",
        ok: true,
        detail: "ok",
      });
    },
  );

  it.each([
    ["nothing", {}],
    ["a workflow only", { ".github/workflows/ci.yml": "x" }],
    ["a renovate.json in a sub-folder", { "api/renovate.json": "{}" }],
    [
      ".renovaterc in .github (not a place Renovate reads here)",
      { ".github/.renovaterc": "{}" },
    ],
    ["a backup of the config", { ".github/dependabot.yml.bak": "x" }],
    [
      "a directory called dependabot.yml",
      { ".github/dependabot.yml/a.txt": "x" },
    ],
    ["a dependabot.yml at the root", { "dependabot.yml": "version: 2\n" }],
  ])(
    "given a repo with %s, when the health is read, then updates is red missing",
    async (_name, files) => {
      const { health } = await lines(files);

      expect(lineOf(await health(), "updates")).toEqual({
        key: "updates",
        ok: false,
        detail: "missing",
      });
    },
  );

  it("given a repo with a dependabot.yml and nothing else, when the health is read, then .github is read once, pinned to the commit of the root, next to .github/workflows", async () => {
    const { health, fetchMock } = await lines({
      ".github/dependabot.yml": "version: 2\n",
    });

    await health();

    const trees = githubCalls(fetchMock)
      .filter((c) => c.path.includes("/git/trees/"))
      .map((c) =>
        decodeURIComponent(c.path)
          .replace(/[0-9a-f]{40}/, "SHA")
          .replace("/repos/user1000/app/git/trees/", ""),
      )
      .sort();
    expect(trees).toEqual(["HEAD", "SHA:.github", "SHA:.github/workflows"]);
  });

  it("given a repo whose root has no .github, when the health is read, then .github is not read", async () => {
    const { health, fetchMock } = await lines({ "renovate.json": "{}" });

    await health();

    expect(
      githubCalls(fetchMock).filter((c) => c.path.includes("/git/trees/")),
    ).toHaveLength(1);
  });
});
