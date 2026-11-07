// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice 1.6, decision 012 G (reopened): the Réglages page, with the administrator's block list.
// Slice 4.1: the page and its link are every user's (the MCP tokens); the block list stays the administrator's.

type User = {
  id: number;
  login: string;
  isAdmin: boolean;
  blockedAt: string | null;
  createdAt: string;
};
type State = {
  isAdmin: boolean;
  users: User[];
  /** What POST .../block answers instead of blocking. */
  blockAnswer?: Response;
};
type Call = { method: string; path: string; body: string };

const user = (id: number, login: string, extra: Partial<User> = {}): User => ({
  id,
  login,
  isAdmin: false,
  blockedAt: null,
  createdAt: "2026-10-23T10:00:00.000Z",
  ...extra,
});

const admin = user(1, "root-admin", { isAdmin: true });
const blockedAt = "2026-10-24T08:00:00.000Z";

function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}

/** A small fake server behind fetch: it keeps its state, so a refetch shows the change. */
function stubApi(state: State) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      const body =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      calls.push({ method, path, body });

      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({
          login: "dorian",
          name: "Dorian",
          avatarUrl: null,
          isAdmin: state.isAdmin,
        });
      // The banner is not what these tests are about: the App is installed.
      if (path === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
        });
      // The MCP tokens have their own tests (SettingsTokens.test.tsx): none here.
      if (path === "/api/me/tokens" && method === "GET")
        return Response.json({ tokens: [] });
      if (path === "/api/settings/users" && method === "GET")
        return state.isAdmin
          ? Response.json({ users: state.users })
          : Response.json({ error: "Forbidden" }, { status: 403 });
      const action = /^\/api\/settings\/users\/(\d+)\/(block|unblock)$/.exec(
        path,
      );
      if (action && method === "POST") {
        if (action[2] === "block" && state.blockAnswer)
          return state.blockAnswer;
        state.users = state.users.map((u) =>
          u.id === Number(action[1])
            ? { ...u, blockedAt: action[2] === "block" ? blockedAt : null }
            : u,
        );
        return new Response(null, { status: 204 });
      }
      // The « Connecter Claude » section (decision 021 G) has its own tests (ConnectClaude.test.tsx): nothing connected here.
      if (path === "/api/me/connect" && method === "GET")
        return Response.json({
          mcpUrl: "https://cockpit.example.com/mcp",
          connected: false,
          connectedAt: null,
        });
      // Decision 022: the section « Écrire les US automatiquement » has its own tests (RoutineSettings.test.tsx): nothing connected here.
      if (path === "/api/me/routine" && method === "GET")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

const listCalls = (calls: Call[]) =>
  calls.filter((c) => c.method === "GET" && c.path === "/api/settings/users")
    .length;

const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

const rowOf = (text: string) => {
  const row = screen.getByText(text).closest("li, tr");
  expect(row, `${text} must be inside a list item or a row`).not.toBeNull();
  return row as HTMLElement;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("navigation to Réglages", () => {
  it("given an administrator, when the home page loads, then the header links to /reglages", async () => {
    stubApi({ isAdmin: true, users: [admin] });

    renderAt("/");

    const link = await screen.findByRole("link", { name: "Réglages" });
    expect(link.getAttribute("href")).toBe("/reglages");
  });

  it("given a user who is not an administrator, when the home page loads, then the header links to /reglages too", async () => {
    stubApi({ isAdmin: false, users: [admin] });

    renderAt("/");

    // Wait for /api/me to be read: the Projets link is there for everybody.
    await screen.findByText("Dorian");
    const link = await screen.findByRole("link", { name: "Réglages" });
    expect(link.getAttribute("href")).toBe("/reglages");
  });
});

describe("Réglages page, for a user who is not an administrator", () => {
  it("given a user who is not an administrator, when /reglages/jetons loads, then it has the heading Réglages and the section Jetons MCP but no section Utilisateurs", async () => {
    const calls = stubApi({ isAdmin: false, users: [admin, user(2, "alice")] });

    renderAt("/reglages/jetons");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /^Connecte|^Les jetons|^Voici ceux/,
      }),
    ).toBeDefined();
    expect(
      await screen.findByRole("heading", { name: "Jetons MCP" }),
    ).toBeDefined();
    // The page knows who asks before it decides: wait for /api/me, then for the lists to settle.
    await waitFor(() =>
      expect(calls.some((c) => c.path === "/api/me")).toBe(true),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.path === "/api/me/tokens")).toBe(true),
    );
    expect(screen.queryByRole("heading", { name: "Utilisateurs" })).toBeNull();
    expect(screen.queryByText("alice")).toBeNull();
    expect(screen.queryByRole("button", { name: "Bloquer" })).toBeNull();
    expect(calls.some((c) => c.path === "/api/settings/users")).toBe(false);
  });

  it("given an administrator, when /reglages/jetons loads, then the section Jetons MCP is there and the users are not asked (decision 028 H)", async () => {
    const calls = stubApi({ isAdmin: true, users: [admin] });

    renderAt("/reglages/jetons");

    expect(
      await screen.findByRole("heading", { name: "Jetons MCP" }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Utilisateurs" })).toBeNull();
    expect(calls.some((c) => c.path === "/api/settings/users")).toBe(false);
  });

  it("given an administrator, when /reglages/utilisateurs loads, then the section Utilisateurs is there and the section Jetons MCP is not (decision 028 H)", async () => {
    stubApi({ isAdmin: true, users: [admin] });

    renderAt("/reglages/utilisateurs");

    expect(
      await screen.findByRole("heading", { name: "Utilisateurs" }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Jetons MCP" })).toBeNull();
  });
});

describe("Réglages page, the users", () => {
  it("given the admin and two users, when /reglages/utilisateurs loads, then it has the heading Réglages, a section Utilisateurs and lists every login", async () => {
    stubApi({
      isAdmin: true,
      users: [admin, user(2, "alice-dev"), user(3, "bob")],
    });

    renderAt("/reglages/utilisateurs");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /^Connecte|^Les jetons|^Voici ceux/,
      }),
    ).toBeDefined();
    expect(screen.getByRole("heading", { name: "Utilisateurs" })).toBeDefined();
    expect(await screen.findByText("alice-dev")).toBeDefined();
    expect(screen.getByText("bob")).toBeDefined();
    expect(screen.getByText("root-admin")).toBeDefined();
  });

  it("given the admin and a user, when /reglages/utilisateurs loads, then the admin is marked Administrateur without a Bloquer button and the user has one", async () => {
    stubApi({ isAdmin: true, users: [admin, user(2, "alice-dev")] });
    renderAt("/reglages/utilisateurs");
    await screen.findByText("alice-dev");

    const adminRow = within(rowOf("root-admin"));
    expect(adminRow.getByText("Administrateur")).toBeDefined();
    expect(adminRow.queryByRole("button", { name: "Bloquer" })).toBeNull();
    const userRow = within(rowOf("alice-dev"));
    expect(userRow.queryByText("Administrateur")).toBeNull();
    expect(userRow.getByRole("button", { name: "Bloquer" })).toBeDefined();
  });

  it("given the old allow-list is gone, when /reglages/utilisateurs loads, then there is no form Ajouter un compte and the accounts route is never called", async () => {
    const calls = stubApi({ isAdmin: true, users: [admin, user(2, "bob")] });

    renderAt("/reglages/utilisateurs");
    await screen.findByText("bob");

    expect(screen.queryByLabelText("Login GitHub")).toBeNull();
    expect(screen.queryByText(/Ajouter un compte/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Ajouter/ })).toBeNull();
    expect(calls.some((c) => c.path === "/api/settings/accounts")).toBe(false);
  });
});

describe("Réglages page, blocking a user", () => {
  it("given a user, when Bloquer is clicked, then a confirmation is asked on the spot and nothing is sent until it is confirmed, then the list is refetched with the user marked Bloqué", async () => {
    const calls = stubApi({
      isAdmin: true,
      users: [admin, user(2, "alice-dev"), user(3, "bob")],
    });
    renderAt("/reglages/utilisateurs");
    await screen.findByText("alice-dev");

    fireEvent.click(
      within(rowOf("alice-dev")).getByRole("button", { name: "Bloquer" }),
    );

    const confirm = await screen.findByRole("button", { name: /Confirmer/ });
    expect(posts(calls)).toHaveLength(0);
    const listsBefore = listCalls(calls);

    fireEvent.click(confirm);

    await waitFor(() =>
      expect(
        posts(calls).some((c) => c.path === "/api/settings/users/2/block"),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(within(rowOf("alice-dev")).getByText("Bloqué")).toBeDefined(),
    );
    expect(
      within(rowOf("alice-dev")).getByRole("button", { name: "Débloquer" }),
    ).toBeDefined();
    expect(
      within(rowOf("alice-dev")).queryByRole("button", { name: "Bloquer" }),
    ).toBeNull();
    // bob is untouched.
    expect(within(rowOf("bob")).queryByText("Bloqué")).toBeNull();
    expect(listCalls(calls)).toBeGreaterThan(listsBefore);
  });

  it("given a confirmation is asked, when Annuler is clicked, then nothing is sent and the user keeps their Bloquer button", async () => {
    const calls = stubApi({
      isAdmin: true,
      users: [admin, user(2, "alice-dev")],
    });
    renderAt("/reglages/utilisateurs");
    await screen.findByText("alice-dev");
    fireEvent.click(screen.getByRole("button", { name: "Bloquer" }));

    fireEvent.click(await screen.findByRole("button", { name: "Annuler" }));

    expect(screen.getByRole("button", { name: "Bloquer" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Confirmer/ })).toBeNull();
    expect(posts(calls)).toHaveLength(0);
  });

  it.each([
    ["already_blocked", 409, /bloqué/i],
    ["cannot_block_admin", 409, /administrateur/i],
    ["Internal Server Error", 500, /échoué|réessaie/i],
  ])(
    "given the server answers %s (%i), when a block is confirmed, then an alert explains it in French, without the raw code",
    async (code, status, french) => {
      stubApi({
        isAdmin: true,
        users: [admin, user(2, "alice-dev")],
        blockAnswer: Response.json({ error: code }, { status }),
      });
      renderAt("/reglages/utilisateurs");
      await screen.findByText("alice-dev");
      fireEvent.click(screen.getByRole("button", { name: "Bloquer" }));
      fireEvent.click(await screen.findByRole("button", { name: /Confirmer/ }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(french);
      expect(alert.textContent).not.toContain(code);
    },
  );
});

describe("Réglages page, unblocking a user", () => {
  it("given a blocked user, when Débloquer is clicked, then the request is sent at once without confirmation and the list is refetched with the user active again", async () => {
    const calls = stubApi({
      isAdmin: true,
      users: [admin, user(2, "alice-dev", { blockedAt })],
    });
    renderAt("/reglages/utilisateurs");
    await screen.findByText("alice-dev");
    expect(within(rowOf("alice-dev")).getByText("Bloqué")).toBeDefined();
    const listsBefore = listCalls(calls);

    fireEvent.click(
      within(rowOf("alice-dev")).getByRole("button", { name: "Débloquer" }),
    );

    await waitFor(() =>
      expect(
        posts(calls).some((c) => c.path === "/api/settings/users/2/unblock"),
      ).toBe(true),
    );
    expect(screen.queryByRole("button", { name: /Confirmer/ })).toBeNull();
    await waitFor(() =>
      expect(
        within(rowOf("alice-dev")).getByRole("button", { name: "Bloquer" }),
      ).toBeDefined(),
    );
    expect(within(rowOf("alice-dev")).queryByText("Bloqué")).toBeNull();
    expect(listCalls(calls)).toBeGreaterThan(listsBefore);
  });
});
