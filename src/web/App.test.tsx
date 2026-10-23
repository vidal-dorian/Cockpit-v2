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

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

const health = () => Response.json({ status: "ok", version: "0.1.0" });
const unauthorized = () =>
  Response.json({ error: "Unauthorized" }, { status: 401 });
const octocat = {
  login: "octocat",
  name: "The Octocat",
  avatarUrl: "https://avatars/1",
};

type Handler = (request: { method: string }) => Response;

/** Stubs fetch by "METHOD /path"; any other call fails the test loudly. */
function stubApi(userRoutes: Record<string, Handler>) {
  // The instance is configured unless a test says otherwise (decision 012).
  const routes: Record<string, Handler> = {
    "GET /api/setup/status": () =>
      Response.json({ configured: true, detectedUrl: "http://localhost" }),
    ...userRoutes,
  };
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const handler =
        routes[`${method} ${new URL(raw, "http://localhost").pathname}`];
      if (!handler) throw new Error(`Unexpected fetch ${method} ${raw}`);
      return handler({ method });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calledWith(fetchMock: ReturnType<typeof stubApi>, key: string) {
  return fetchMock.mock.calls.some(([input, init]) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    return `${method} ${new URL(raw, "http://localhost").pathname}` === key;
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("home page", () => {
  it("shows the title and the server version", async () => {
    stubApi({ "GET /api/health": health, "GET /api/me": unauthorized });

    renderApp();

    expect(
      await screen.findByRole("heading", { name: "Cockpit" }),
    ).toBeDefined();
    expect(await screen.findByText("Serveur OK · v0.1.0")).toBeDefined();
  });

  it("shows the error and lets the user retry", async () => {
    let healthCalls = 0;
    stubApi({
      "GET /api/health": () => {
        healthCalls += 1;
        if (healthCalls === 1) throw new TypeError("Failed to fetch");
        return health();
      },
      "GET /api/me": unauthorized,
    });

    renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Serveur injoignable : Failed to fetch",
    );

    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Serveur OK · v0.1.0")).toBeDefined();
  });
});

describe("login", () => {
  it("given /api/me answers 401, when the page loads, then it shows a link to log in with GitHub", async () => {
    stubApi({ "GET /api/health": health, "GET /api/me": unauthorized });

    renderApp();

    const link = await screen.findByRole("link", {
      name: "Se connecter avec GitHub",
    });
    expect(link.getAttribute("href")).toBe("/api/auth/login");
  });

  it("given /api/me answers a user, when the page loads, then it shows their name and a logout button", async () => {
    stubApi({
      "GET /api/health": health,
      "GET /api/me": () => Response.json(octocat),
    });

    renderApp();

    expect(await screen.findByText("The Octocat")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Se déconnecter" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("link", { name: "Se connecter avec GitHub" }),
    ).toBeNull();
  });

  it("given a logged-in user, when they click Se déconnecter, then POST /api/auth/logout is sent and the login link appears", async () => {
    let loggedIn = true;
    const fetchMock = stubApi({
      "GET /api/health": health,
      "GET /api/me": () => (loggedIn ? Response.json(octocat) : unauthorized()),
      "POST /api/auth/logout": () => {
        loggedIn = false;
        return Response.json({ ok: true });
      },
    });
    renderApp();

    fireEvent.click(
      await screen.findByRole("button", { name: "Se déconnecter" }),
    );

    await waitFor(() =>
      expect(calledWith(fetchMock, "POST /api/auth/logout")).toBe(true),
    );
    const link = await screen.findByRole("link", {
      name: "Se connecter avec GitHub",
    });
    expect(link.getAttribute("href")).toBe("/api/auth/login");
  });
});

describe("login errors", () => {
  it("given ?erreur=compte-non-autorise&login=octocat, when the page loads, then an alert says the account is not allowed", async () => {
    window.history.replaceState(
      {},
      "",
      "/?erreur=compte-non-autorise&login=octocat",
    );
    stubApi({ "GET /api/health": health, "GET /api/me": unauthorized });

    renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Le compte GitHub octocat n'est pas autorisé sur ce Cockpit.",
    );
  });

  it("given a crafted login in the URL, when the page loads, then the alert ignores it and uses the generic sentence", async () => {
    window.history.replaceState(
      {},
      "",
      `/?erreur=compte-non-autorise&login=${encodeURIComponent("Appelez le 0800 000 000")}`,
    );
    stubApi({ "GET /api/health": health, "GET /api/me": unauthorized });

    renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert.querySelector("p")?.textContent).toBe(
      "Ce compte GitHub n'est pas autorisé sur ce Cockpit.",
    );
    expect(alert.textContent).not.toContain("0800");
  });

  it("given ?erreur=connexion-echouee, when the page loads, then an alert says the login failed and offers Réessayer", async () => {
    window.history.replaceState({}, "", "/?erreur=connexion-echouee");
    stubApi({ "GET /api/health": health, "GET /api/me": unauthorized });

    renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("La connexion avec GitHub a échoué.");
    const retry = within(alert).getByRole("link", { name: "Réessayer" });
    expect(retry.getAttribute("href")).toBe("/api/auth/login");
  });
});
