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

// Slice 1.6, decision 012 G: the administrator's Réglages page.

type Account = { id: number; login: string; createdAt: string };
type State = {
  isAdmin: boolean;
  accounts: Account[];
  /** What POST /api/settings/accounts answers instead of creating the account. */
  addAnswer?: Response;
};
type Call = { method: string; path: string; body: string };

const account = (id: number, login: string): Account => ({
  id,
  login,
  createdAt: "2026-10-23T10:00:00.000Z",
});

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
      if (path === "/api/settings/accounts" && method === "GET")
        return Response.json({ accounts: state.accounts });
      if (path === "/api/settings/accounts" && method === "POST") {
        if (state.addAnswer) return state.addAnswer;
        const { login } = JSON.parse(body) as { login: string };
        const created = account(100 + state.accounts.length, login);
        state.accounts.push(created);
        return Response.json({ account: created }, { status: 201 });
      }
      const revokeMatch = /^\/api\/settings\/accounts\/(\d+)$/.exec(path);
      if (revokeMatch && method === "DELETE") {
        state.accounts = state.accounts.filter(
          (a) => a.id !== Number(revokeMatch[1]),
        );
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

const listCalls = (calls: Call[]) =>
  calls.filter((c) => c.method === "GET" && c.path === "/api/settings/accounts")
    .length;

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
    stubApi({ isAdmin: true, accounts: [] });

    renderAt("/");

    const link = await screen.findByRole("link", { name: "Réglages" });
    expect(link.getAttribute("href")).toBe("/reglages");
  });

  it("given a user who is not an administrator, when the home page loads, then there is no Réglages link", async () => {
    stubApi({ isAdmin: false, accounts: [] });

    renderAt("/");

    // Wait for /api/me to be read: the Projets link is there for everybody.
    await screen.findByText("Dorian");
    expect(screen.queryByRole("link", { name: "Réglages" })).toBeNull();
  });
});

describe("Réglages page, allowed accounts", () => {
  it("given two allowed accounts, when /reglages loads, then it has the heading Réglages and lists both logins", async () => {
    stubApi({
      isAdmin: true,
      accounts: [account(1, "alice-dev"), account(2, "bob")],
    });

    renderAt("/reglages");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Réglages" }),
    ).toBeDefined();
    expect(await screen.findByText("alice-dev")).toBeDefined();
    expect(screen.getByText("bob")).toBeDefined();
  });

  it("given the form Ajouter un compte, when a login is typed in Login GitHub and sent, then POST /api/settings/accounts carries it and the list is refetched with the new account", async () => {
    const calls = stubApi({ isAdmin: true, accounts: [account(1, "bob")] });
    renderAt("/reglages");
    await screen.findByText("bob");
    const listsBefore = listCalls(calls);

    fireEvent.change(screen.getByLabelText("Login GitHub"), {
      target: { value: "carol" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ajouter/ }));

    const post = await waitFor(() => {
      const found = calls.find(
        (c) => c.method === "POST" && c.path === "/api/settings/accounts",
      );
      expect(found).toBeDefined();
      return found;
    });
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ login: "carol" });
    expect(await screen.findByText("carol")).toBeDefined();
    expect(listCalls(calls)).toBeGreaterThan(listsBefore);
  });

  it("given the server answers 409 already_allowed, when a login is added, then an alert explains in French that the account is already allowed, without the raw code", async () => {
    stubApi({
      isAdmin: true,
      accounts: [account(1, "bob")],
      addAnswer: Response.json({ error: "already_allowed" }, { status: 409 }),
    });
    renderAt("/reglages");
    await screen.findByText("bob");

    fireEvent.change(screen.getByLabelText("Login GitHub"), {
      target: { value: "bob" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ajouter/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/déjà/i);
    expect(alert.textContent).not.toContain("already_allowed");
  });

  it("given the server answers 400, when a login is added, then an alert tells in French that the login is not valid, without the raw error", async () => {
    stubApi({
      isAdmin: true,
      accounts: [],
      addAnswer: Response.json({ error: "Bad request" }, { status: 400 }),
    });
    renderAt("/reglages");
    await screen.findByLabelText("Login GitHub");

    fireEvent.change(screen.getByLabelText("Login GitHub"), {
      target: { value: "-nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ajouter/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/login/i);
    expect(alert.textContent).not.toContain("Bad request");
  });
});

describe("Réglages page, removing an account", () => {
  it("given an allowed account, when Retirer is clicked, then a confirmation is asked on the spot and nothing is sent until it is confirmed, then the list is refetched without the account", async () => {
    const calls = stubApi({
      isAdmin: true,
      accounts: [account(1, "alice-dev"), account(2, "bob")],
    });
    renderAt("/reglages");
    await screen.findByText("alice-dev");

    fireEvent.click(
      within(rowOf("alice-dev")).getByRole("button", { name: "Retirer" }),
    );

    const confirm = await screen.findByRole("button", { name: /Confirmer/ });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const listsBefore = listCalls(calls);

    fireEvent.click(confirm);

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === "DELETE" && c.path === "/api/settings/accounts/1",
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("alice-dev")).toBeNull());
    expect(screen.getByText("bob")).toBeDefined();
    expect(listCalls(calls)).toBeGreaterThan(listsBefore);
  });

  it("given a confirmation is asked, when Annuler is clicked, then nothing is sent and the account stays with its Retirer button", async () => {
    const calls = stubApi({
      isAdmin: true,
      accounts: [account(1, "alice-dev")],
    });
    renderAt("/reglages");
    await screen.findByText("alice-dev");
    fireEvent.click(screen.getByRole("button", { name: "Retirer" }));

    fireEvent.click(await screen.findByRole("button", { name: "Annuler" }));

    expect(screen.getByText("alice-dev")).toBeDefined();
    expect(screen.getByRole("button", { name: "Retirer" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Confirmer/ })).toBeNull();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
