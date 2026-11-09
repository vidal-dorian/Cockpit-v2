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

// Slice 13.1 (decision 076 E, C): the page /invitations/<secret>. Server contract in src/server/test-members.ts:
// GET /api/invitations/:secret (401 = not logged in, 404 = « plus valable »), POST /api/invitations/:secret/accept -> { authorizeUrl },
// the page then goes to that URL (window.location.assign). The page lands back on /invitations/<secret>?erreur=sans-acces when the
// invitee cannot read the repo on GitHub.

const SECRET = "s3cr3t-link-value-0123456789";
const AUTHORIZE =
  "https://github.com/login/oauth/authorize?client_id=x&state=abc";

function stubApi(answer: Response, accept?: Response) {
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      calls.push({ method, path });
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return answer.status === 401
          ? Response.json({ error: "Unauthorized" }, { status: 401 })
          : Response.json({
              login: "carol",
              name: "Carol",
              avatarUrl: null,
              isAdmin: false,
            });
      if (path === `/api/invitations/${SECRET}` && method === "GET")
        return answer.clone();
      if (path === `/api/invitations/${SECRET}/accept` && method === "POST")
        return accept ?? Response.json({ authorizeUrl: AUTHORIZE });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const VALID = () =>
  Response.json({
    invitation: {
      owner: "dorian",
      fullName: "acme/gestion",
      role: "can_validate",
    },
  });

describe("/invitations/<secret> (076 E)", () => {
  it("given a valid link, when Carol opens it, then it says who invites her, on which repo, with which role, and offers Accepter", async () => {
    stubApi(VALID());

    renderAt(`/invitations/${SECRET}`);

    await screen.findByText(/@dorian/);
    const page = screen.getByRole("main");
    expect(page.textContent).toContain("t'invite sur");
    expect(page.textContent).toContain("acme/gestion");
    expect(page.textContent).toContain("rôle : peut valider");
    expect(screen.getByRole("button", { name: "Accepter" })).toBeDefined();
  });

  it("given a valid link, when Carol clicks Accepter, then the accept route is called and the page goes to GitHub's authorization", async () => {
    const calls = stubApi(VALID());
    const assign = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      assign,
      href: window.location.href,
    });
    renderAt(`/invitations/${SECRET}`);

    fireEvent.click(await screen.findByRole("button", { name: "Accepter" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(AUTHORIZE));
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(
      [`/api/invitations/${SECRET}/accept`],
    );
  });

  it("given a link that is no longer valid, when it is opened, then « Ce lien d'invitation n'est plus valable. Demande-en un nouveau. » and no Accepter", async () => {
    stubApi(Response.json({ error: "invalid_invitation" }, { status: 404 }));

    renderAt(`/invitations/${SECRET}`);

    await screen.findByText(
      "Ce lien d'invitation n'est plus valable. Demande-en un nouveau.",
    );
    expect(screen.queryByRole("button", { name: "Accepter" })).toBeNull();
  });

  it("given nobody logged in, when the link is opened, then « Se connecter avec GitHub » leads to the login and comes back to the link", async () => {
    stubApi(Response.json({ error: "Unauthorized" }, { status: 401 }));

    renderAt(`/invitations/${SECRET}`);

    const link = await screen.findByRole("link", {
      name: "Se connecter avec GitHub",
    });
    expect(link.getAttribute("href")).toBe(
      `/api/auth/login?next=${encodeURIComponent(`/invitations/${SECRET}`)}`,
    );
  });

  it("given the return erreur=sans-acces, when the page loads, then it says the invitee has no access to owner/repo on GitHub, to ask @dorian to add her as a collaborator, then reopen the link", async () => {
    stubApi(VALID());

    renderAt(`/invitations/${SECRET}?erreur=sans-acces`);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Tu n'as pas accès à acme/gestion sur GitHub.",
    );
    expect(alert.textContent).toContain(
      "Demande à @dorian de t'y ajouter comme collaborateur, puis rouvre ce lien.",
    );
  });
});
