// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// The router lives inside App (browser router), so the tests set the URL like a browser would.
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

const octocat = {
  login: "octocat",
  name: "The Octocat",
  avatarUrl: "https://avatars/1",
};

/** Stubs fetch by pathname; the history answer is a function so a test can fail then succeed. */
function stubApi(history: () => Response) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const path = new URL(raw, "http://localhost").pathname;
    if (path === "/api/setup/status")
      return Response.json({
        configured: true,
        detectedUrl: "http://localhost",
      });
    if (path === "/api/health")
      return Response.json({ status: "ok", version: "0.1.0" });
    if (path === "/api/me") return Response.json(octocat);
    if (path === "/api/history") return history();
    throw new Error(`Unexpected fetch ${raw}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const historyCalls = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([input]) =>
    String(input instanceof Request ? input.url : input).includes(
      "/api/history",
    ),
  ).length;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("Journal page", () => {
  it("given entries for a login and a logout, when /journal loads, then each row says its action and its result in French, with a date", async () => {
    stubApi(() =>
      Response.json({
        entries: [
          {
            id: 2,
            at: "2026-10-22T12:00:00.000Z",
            actor: "human",
            origin: "ui",
            action: "logout",
            result: "ok",
          },
          {
            id: 1,
            at: "2026-10-21T12:00:00.000Z",
            actor: "human",
            origin: "ui",
            action: "login",
            result: "ok",
          },
        ],
      }),
    );

    renderAt("/journal");

    const login = (await screen.findByText("Connexion")).closest("li, tr");
    const logout = screen.getByText("Déconnexion").closest("li, tr");
    expect(login).not.toBeNull();
    expect(logout).not.toBeNull();
    expect(login).not.toBe(logout);
    expect(within(login as HTMLElement).getByText("Réussie")).toBeDefined();
    expect(within(logout as HTMLElement).getByText("Réussie")).toBeDefined();
    expect(login?.textContent).toMatch(/2026/);
  });

  it("given entries for a token creation and a revocation, when /journal loads, then the rows read Jeton créé and Jeton révoqué", async () => {
    stubApi(() =>
      Response.json({
        entries: [
          {
            id: 2,
            at: "2026-10-22T12:00:00.000Z",
            actor: "human",
            origin: "ui",
            action: "revoke_token",
            result: "ok",
          },
          {
            id: 1,
            at: "2026-10-21T12:00:00.000Z",
            actor: "human",
            origin: "ui",
            action: "create_token",
            result: "ok",
          },
        ],
      }),
    );

    renderAt("/journal");

    const created = (await screen.findByText("Jeton créé")).closest("li, tr");
    const revoked = screen.getByText("Jeton révoqué").closest("li, tr");
    expect(created).not.toBeNull();
    expect(revoked).not.toBeNull();
    expect(created).not.toBe(revoked);
    expect(screen.queryByText("create_token")).toBeNull();
    expect(screen.queryByText("revoke_token")).toBeNull();
  });

  it.each([
    ["refused", "Refusée"],
    ["error", "Erreur"],
  ])(
    "given an entry whose result is %s, when /journal loads, then the result reads %s",
    async (result, words) => {
      stubApi(() =>
        Response.json({
          entries: [
            {
              id: 1,
              at: "2026-10-22T12:00:00.000Z",
              actor: "human",
              origin: "ui",
              action: "login",
              result,
            },
          ],
        }),
      );

      renderAt("/journal");

      const row = (await screen.findByText("Connexion")).closest("li, tr");
      expect(within(row as HTMLElement).getByText(words)).toBeDefined();
    },
  );

  it("given an entry with a project, when /journal loads, then the row shows the project name", async () => {
    stubApi(() =>
      Response.json({
        entries: [
          {
            id: 1,
            at: "2026-10-21T12:00:00.000Z",
            actor: "human",
            origin: "ui",
            action: "login",
            result: "ok",
            project: "octocat/hello",
          },
        ],
      }),
    );

    renderAt("/journal");

    const row = (await screen.findByText("Connexion")).closest("li, tr");
    expect(row?.textContent).toContain("octocat/hello");
  });

  it("given an empty history, when /journal loads, then it says there is no entry yet", async () => {
    stubApi(() => Response.json({ entries: [] }));

    renderAt("/journal");

    expect(
      await screen.findByText("Aucune entrée pour l'instant."),
    ).toBeDefined();
  });

  it("given /api/history answers 401, when /journal loads, then it offers to log in with GitHub", async () => {
    stubApi(() => Response.json({ error: "Unauthorized" }, { status: 401 }));

    renderAt("/journal");

    const link = await screen.findByRole("link", {
      name: "Se connecter avec GitHub",
    });
    expect(link.getAttribute("href")).toBe("/api/auth/login");
  });

  it("given a network failure, when /journal loads, then an alert shows and Réessayer fetches again", async () => {
    let calls = 0;
    const fetchMock = stubApi(() => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return Response.json({ entries: [] });
    });

    renderAt("/journal");

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(
      await screen.findByText("Aucune entrée pour l'instant."),
    ).toBeDefined();
    expect(historyCalls(fetchMock)).toBe(2);
  });
});

describe("navigation", () => {
  it("given the home page, when it loads, then the header links to /journal", async () => {
    stubApi(() => Response.json({ entries: [] }));

    renderAt("/");

    const link = await screen.findByRole("link", { name: "Journal" });
    expect(link.getAttribute("href")).toBe("/journal");
  });

  it("given the Journal page, when it loads, then the Journal link is the current page and Accueil is not", async () => {
    stubApi(() => Response.json({ entries: [] }));

    renderAt("/journal");

    const journal = await screen.findByRole("link", { name: "Journal" });
    expect(journal.getAttribute("aria-current")).toBe("page");
    const home = screen.getByRole("link", { name: "Accueil" });
    expect(home.getAttribute("aria-current")).toBeNull();
  });
});
