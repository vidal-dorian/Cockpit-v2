// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Decision 021 C: the /autoriser page, where claude.ai (or Claude Code) sends the user to approve the connection.
//
// Pinned choices:
// - the page asks GET /api/oauth/request?<its own query string> and reads { clientName, returnHost }, or a 400;
// - Autoriser and Refuser POST /api/oauth/approve with the query as JSON fields plus
//   `decision: "approve" | "deny"` and read { redirectUrl }, then call window.location.assign(redirectUrl);
// - without a session the page shows the link « Se connecter avec GitHub » to /api/auth/login?next=<the page URL>.

const PARAMS = {
  response_type: "code",
  client_id: "https://claude.ai/oauth/claude-code-client-metadata",
  redirect_uri: "http://localhost:54321/callback",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  code_challenge_method: "S256",
  state: "xyz state&=",
  resource: "https://cockpit.example.com/mcp",
};
const SEARCH = `?${new URLSearchParams(PARAMS).toString()}`;
const RETURN_URL = "http://localhost:54321/callback?code=abc&state=xyz";
const DENIED_URL =
  "http://localhost:54321/callback?error=access_denied&state=xyz";

type Options = {
  session?: boolean;
  /** What GET /api/oauth/request answers. */
  request?: Response;
  /** What POST /api/oauth/approve answers. */
  approve?: Response;
};
type Call = { method: string; path: string; search: string; body: string };

/** The page is read from the real URL; only `assign` is replaced, to see where the page goes. */
function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  const assign = vi.fn();
  vi.stubGlobal("location", {
    href: window.location.href,
    origin: window.location.origin,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    assign,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
  return assign;
}

function stubApi(options: Options = {}) {
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
      const url = new URL(raw, "http://localhost");
      const body =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      calls.push({ method, path: url.pathname, search: url.search, body });

      if (url.pathname === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (url.pathname === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (url.pathname === "/api/me")
        return options.session === false
          ? Response.json({ error: "Unauthorized" }, { status: 401 })
          : Response.json({
              login: "dorian",
              name: "Dorian",
              avatarUrl: null,
              isAdmin: false,
            });
      if (url.pathname === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
        });
      if (url.pathname === "/api/oauth/request" && method === "GET")
        return (
          options.request ??
          Response.json({ clientName: "Claude Code", returnHost: "localhost" })
        );
      if (url.pathname === "/api/oauth/approve" && method === "POST")
        return options.approve ?? Response.json({ redirectUrl: RETURN_URL });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const invalid = () =>
  Response.json({ error: "invalid_request" }, { status: 400 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("/autoriser page", () => {
  it("given a valid request, when the page loads, then it says the client wants to access the projects, shows the return host and offers Autoriser and Refuser", async () => {
    const calls = stubApi();

    renderAt(`/autoriser${SEARCH}`);

    await screen.findByRole("button", { name: "Autoriser" });
    expect(screen.getByRole("button", { name: "Refuser" })).toBeDefined();
    expect(text()).toContain("Claude Code veut accéder à tes projets Cockpit");
    expect(text()).toContain("localhost");
    const asked = calls.find((c) => c.path === "/api/oauth/request");
    expect(Object.fromEntries(new URLSearchParams(asked?.search))).toEqual(
      PARAMS,
    );
  });

  it("given a claude.ai client, when the page loads, then the name is claude.ai and the return host claude.ai", async () => {
    stubApi({
      request: Response.json({
        clientName: "claude.ai",
        returnHost: "claude.ai",
      }),
    });

    renderAt(`/autoriser${SEARCH}`);

    await screen.findByRole("button", { name: "Autoriser" });
    expect(text()).toContain("claude.ai veut accéder à tes projets Cockpit");
  });

  it("given the page, when Autoriser is clicked, then it posts the approval with the request and then goes to the returned URL", async () => {
    const calls = stubApi();
    const assign = renderAt(`/autoriser${SEARCH}`);

    fireEvent.click(await screen.findByRole("button", { name: "Autoriser" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(RETURN_URL));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.path).toBe("/api/oauth/approve");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      ...PARAMS,
      decision: "approve",
    });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("given the page, when Refuser is clicked, then it posts the denial and goes to the returned URL", async () => {
    const calls = stubApi({
      approve: Response.json({ redirectUrl: DENIED_URL }),
    });
    const assign = renderAt(`/autoriser${SEARCH}`);

    fireEvent.click(await screen.findByRole("button", { name: "Refuser" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(DENIED_URL));
    const post = calls.find((c) => c.method === "POST");
    expect(JSON.parse(post?.body ?? "{}")).toMatchObject({ decision: "deny" });
  });

  it("given an invalid request, when the page loads, then it shows an error in French, no Autoriser button, and goes nowhere", async () => {
    stubApi({ request: invalid() });
    const assign = renderAt(`/autoriser${SEARCH}`);

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toMatch(/invalide/i);
    expect(alert.textContent).not.toContain("invalid_request");
    expect(screen.queryByRole("button", { name: "Autoriser" })).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it("given the server refuses the approval, when Autoriser is clicked, then an alert in French is shown and the page goes nowhere", async () => {
    stubApi({ approve: invalid() });
    const assign = renderAt(`/autoriser${SEARCH}`);

    fireEvent.click(await screen.findByRole("button", { name: "Autoriser" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("invalid_request");
    expect(alert.textContent?.trim()).not.toBe("");
    expect(assign).not.toHaveBeenCalled();
  });

  it("given no session, when the page loads, then it offers Se connecter avec GitHub, a link to the login that comes back to this very page, and no Autoriser button", async () => {
    stubApi({ session: false });
    renderAt(`/autoriser${SEARCH}`);

    const link = await screen.findByRole("link", {
      name: "Se connecter avec GitHub",
    });

    expect(link.getAttribute("href")).toBe(
      `/api/auth/login?next=${encodeURIComponent(`/autoriser${SEARCH}`)}`,
    );
    expect(screen.queryByRole("button", { name: "Autoriser" })).toBeNull();
  });
});
