import assert from "node:assert/strict";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { projectMembers, projects } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { INSTALLATION_ID, stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  createAdminWithSession,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Decision 023 C: "the new address is used at once, without restarting", for every reader of the address:
// the health of a project (and its cache, decision 013), the GitHub login and the 401 of /mcp.

const OLD_URL = "https://old.example.com";
const NEW_URL = "https://new.example.org";

afterEach(() => {
  vi.unstubAllGlobals();
});

const mcpFile = (url: string, headers: Record<string, string>) =>
  JSON.stringify({ mcpServers: { cockpit: { type: "http", url, headers } } });
// A literal secret: red as soon as Cockpit is recognised in .mcp.json.
const LITERAL = { Authorization: "Bearer ghp_real" };

async function setup() {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY, { publicUrl: OLD_URL });
  const app = createApp(db, "1.2.3", testAppOptions);
  const admin = await createAdminWithSession(db, 1000);
  return { db, app, admin };
}

const changeAddress = (
  app: ReturnType<typeof createApp>,
  cookie: string,
  publicUrl: string,
) =>
  app.request("/api/settings/public-url", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ publicUrl }),
  });

/** The administrator (github id 1000) follows the project user1000/app, whose repo holds `files`. */
async function withRepo(files: Record<string, string>) {
  const fetchMock = stubGitHub({ account: 1000, files });
  const { db, app, admin } = await setup();
  const [project] = await db
    .insert(projects)
    .values({
      githubRepoId: 1,
      fullName: "user1000/app",
      defaultBranch: "main",
      installationId: INSTALLATION_ID,
    })
    .returning({ id: projects.id });
  assert(project);
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: admin.id, role: "owner" });
  const health = async () => {
    const res = await app.request(`/api/projects/${project.id}/health`, {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
    const { lines } = (await res.json()) as {
      lines: { key: string; ok: boolean; detail: string }[];
    };
    return lines.find((line) => line.key === "mcp");
  };
  return { fetchMock, app, admin, health };
}

describe("the health of a project follows the new address (decision 023 C)", () => {
  it("given a repo that declares cockpit at the new address with a literal secret, when the address changes and the repo has a new commit, then the mcp line is red secret_in_clear", async () => {
    const files = { ".mcp.json": mcpFile(`${NEW_URL}/mcp`, LITERAL) };
    const { fetchMock, app, admin, health } = await withRepo(files);
    // Read with the old address: this is not Cockpit, so nothing to judge.
    expect(await health()).toEqual({ key: "mcp", ok: true, detail: "ok" });

    expect((await changeAddress(app, admin.cookie, NEW_URL)).status).toBe(200);
    fetchMock.update({ files: { ...files, "CLAUDE.md": "# Project" } });

    expect(await health()).toEqual({
      key: "mcp",
      ok: false,
      detail: "secret_in_clear",
    });
  });

  it("given the same repo whose HEAD did not change since a health read before the change, when the address changes, then the cached lines are not reused: the mcp line is red secret_in_clear", async () => {
    const files = { ".mcp.json": mcpFile(`${NEW_URL}/mcp`, LITERAL) };
    const { app, admin, health } = await withRepo(files);
    expect(await health()).toEqual({ key: "mcp", ok: true, detail: "ok" });

    expect((await changeAddress(app, admin.cookie, NEW_URL)).status).toBe(200);

    expect(await health()).toEqual({
      key: "mcp",
      ok: false,
      detail: "secret_in_clear",
    });
  });

  it("given a repo that declares cockpit at the old address, when the address changes, then it is no longer recognised and the mcp line is ok", async () => {
    const files = { ".mcp.json": mcpFile(`${OLD_URL}/mcp`, LITERAL) };
    const { app, admin, health } = await withRepo(files);
    expect(await health()).toEqual({
      key: "mcp",
      ok: false,
      detail: "secret_in_clear",
    });

    expect((await changeAddress(app, admin.cookie, NEW_URL)).status).toBe(200);

    expect(await health()).toEqual({ key: "mcp", ok: true, detail: "ok" });
  });
});

describe("the login and the 401 of /mcp follow the new address (decision 023 C)", () => {
  // Decision 024 G: a change of address also tells GitHub (the stub serves it).
  it("given the address was changed, when the user asks to log in, then GitHub is given redirect_uri <new>/api/auth/callback", async () => {
    stubGitHub({ account: null });
    const { app, admin } = await setup();
    const before = await app.request("/api/auth/login");
    expect(
      new URL(before.headers.get("location") ?? "").searchParams.get(
        "redirect_uri",
      ),
    ).toBe(`${OLD_URL}/api/auth/callback`);

    expect((await changeAddress(app, admin.cookie, NEW_URL)).status).toBe(200);

    const res = await app.request("/api/auth/login");
    expect(res.status).toBe(302);
    expect(
      new URL(res.headers.get("location") ?? "").searchParams.get(
        "redirect_uri",
      ),
    ).toBe(`${NEW_URL}/api/auth/callback`);
  });

  it("given the address was changed, when POST /mcp is called without a token, then 401 and WWW-Authenticate names <new>/.well-known/oauth-protected-resource", async () => {
    stubGitHub({ account: null });
    const { app, admin } = await setup();
    const call = () =>
      app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await call()).headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${OLD_URL}/.well-known/oauth-protected-resource"`,
    );

    expect((await changeAddress(app, admin.cookie, NEW_URL)).status).toBe(200);

    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${NEW_URL}/.well-known/oauth-protected-resource"`,
    );
  });
});
