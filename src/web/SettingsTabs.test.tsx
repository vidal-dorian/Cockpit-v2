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

// Decision 023 C, E: Réglages in two tabs, and the administrator's section « Adresse publique ».
//
// Pinned choices (the decision leaves them open):
// - The tabs are two links inside a <nav> (its name is free), « Général » and « Écriture automatique des US »; the
//   open one has aria-current="page", the other has no aria-current.
// - The section « Adresse publique » is a <section aria-labelledby> (role region) with one text field and a button
//   whose name contains « Enregistrer ». The field is empty at first: the current address is shown as text.
// - The GitHub steps (link to appSettingsUrl, `<typed>/api/auth/callback`, `<typed>/api/webhooks/github`) and the
//   note about the claude.ai connector sit in that section, before the button, and follow what is typed.
// - After a save, the page reads the address again (GET) and shows it in place of the old one.
// - A 400 shows the `error` text of the server, in French, in an alert.

const OLD_URL = "https://cockpit.example.com";
const NEW_URL = "https://new.example.org";
const APP_SETTINGS = "https://github.com/settings/apps/cockpit-acme";
const HTTPS_ONLY =
  "L'adresse publique doit commencer par https:// : claude.ai l'exige.";

type State = {
  isAdmin: boolean;
  publicUrl: string;
  /** What PUT answers instead of saving. */
  putAnswer?: Response;
};
type Call = { method: string; path: string; body: string };

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

/** A small fake server behind fetch: it keeps the address, so a refetch shows the change. */
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
          hasAdmin: true,
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
      if (path === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
        });
      if (path === "/api/me/tokens" && method === "GET")
        return Response.json({ tokens: [] });
      if (path === "/api/me/connect" && method === "GET")
        return Response.json({
          mcpUrl: `${state.publicUrl}/mcp`,
          connected: false,
          connectedAt: null,
          client: null,
        });
      if (path === "/api/me/routine" && method === "GET")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      if (path === "/api/settings/users" && method === "GET")
        return state.isAdmin
          ? Response.json({ users: [] })
          : Response.json({ error: "Forbidden" }, { status: 403 });
      if (path === "/api/settings/public-url") {
        if (!state.isAdmin)
          return Response.json({ error: "Forbidden" }, { status: 403 });
        if (method === "GET")
          return Response.json({
            publicUrl: state.publicUrl,
            appSettingsUrl: APP_SETTINGS,
          });
        if (method === "PUT") {
          if (state.putAnswer) return state.putAnswer.clone();
          const sent = JSON.parse(body) as { publicUrl: string };
          state.publicUrl = new URL(sent.publicUrl).origin;
          return Response.json({ publicUrl: state.publicUrl });
        }
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const heading = (name: string) =>
  screen.queryByRole("heading", { level: 2, name });

/** The nav that holds the two tabs, found by its links. */
async function tabs() {
  const general = await screen.findByRole("link", { name: "Général" });
  const routine = screen.getByRole("link", {
    name: "Écriture automatique des US",
  });
  expect(
    general.closest("nav"),
    "the tabs must be links inside a <nav>",
  ).not.toBeNull();
  expect(routine.closest("nav")).toBe(general.closest("nav"));
  return { general, routine };
}

describe("Réglages, the two tabs (decision 023 E)", () => {
  it("given /reglages, when the page loads, then the nav links Général to /reglages and Écriture automatique des US to /reglages/ecriture-us, Général being the open one", async () => {
    stubApi({ isAdmin: false, publicUrl: OLD_URL });

    renderAt("/reglages");

    const { general, routine } = await tabs();
    expect(general.getAttribute("href")).toBe("/reglages");
    expect(routine.getAttribute("href")).toBe("/reglages/ecriture-us");
    expect(general.getAttribute("aria-current")).toBe("page");
    expect(routine.getAttribute("aria-current")).toBeNull();
  });

  it("given /reglages/ecriture-us, when the page loads, then the tabs are the same and Écriture automatique des US is the open one", async () => {
    stubApi({ isAdmin: false, publicUrl: OLD_URL });

    renderAt("/reglages/ecriture-us");

    const { general, routine } = await tabs();
    expect(general.getAttribute("aria-current")).toBeNull();
    expect(routine.getAttribute("aria-current")).toBe("page");
  });

  it("given /reglages, when the tab Écriture automatique des US is clicked, then the routine section replaces the general sections and the tab is marked open", async () => {
    stubApi({ isAdmin: false, publicUrl: OLD_URL });
    renderAt("/reglages");
    const { general, routine } = await tabs();
    await screen.findByRole("heading", { name: "Connecter Claude" });

    fireEvent.click(routine);

    expect(
      await screen.findByRole("heading", {
        name: "Écrire les US automatiquement",
      }),
    ).toBeDefined();
    expect(heading("Connecter Claude")).toBeNull();
    expect(window.location.pathname).toBe("/reglages/ecriture-us");
    expect(routine.getAttribute("aria-current")).toBe("page");
    expect(general.getAttribute("aria-current")).toBeNull();
  });
});

describe("Réglages, what each tab holds", () => {
  it("given an administrator, when /reglages loads, then it holds Connecter Claude, Adresse publique, Utilisateurs and Jetons MCP but not the routine section", async () => {
    const calls = stubApi({ isAdmin: true, publicUrl: OLD_URL });

    renderAt("/reglages");

    for (const name of [
      "Connecter Claude",
      "Adresse publique",
      "Utilisateurs",
      "Jetons MCP",
    ])
      expect(await screen.findByRole("heading", { name })).toBeDefined();
    expect(heading("Écrire les US automatiquement")).toBeNull();
    // Nothing of the routine is read for a page that does not show it.
    expect(calls.some((c) => c.path === "/api/me/routine")).toBe(false);
  });

  it("given a user who is not an administrator, when /reglages loads, then it holds Connecter Claude and Jetons MCP, without Adresse publique, Utilisateurs or the routine section, and the address is never read", async () => {
    const calls = stubApi({ isAdmin: false, publicUrl: OLD_URL });

    renderAt("/reglages");

    expect(
      await screen.findByRole("heading", { name: "Connecter Claude" }),
    ).toBeDefined();
    expect(
      await screen.findByRole("heading", { name: "Jetons MCP" }),
    ).toBeDefined();
    await waitFor(() =>
      expect(calls.some((c) => c.path === "/api/me")).toBe(true),
    );
    expect(heading("Adresse publique")).toBeNull();
    expect(heading("Utilisateurs")).toBeNull();
    expect(heading("Écrire les US automatiquement")).toBeNull();
    expect(calls.some((c) => c.path === "/api/settings/public-url")).toBe(
      false,
    );
  });

  it.each([
    ["an administrator", true],
    ["a user who is not an administrator", false],
  ])(
    "given %s, when /reglages/ecriture-us loads, then it holds the routine section and none of the general ones",
    async (_who, isAdmin) => {
      stubApi({ isAdmin, publicUrl: OLD_URL });

      renderAt("/reglages/ecriture-us");

      expect(
        await screen.findByRole("heading", {
          name: "Écrire les US automatiquement",
        }),
      ).toBeDefined();
      for (const name of [
        "Connecter Claude",
        "Adresse publique",
        "Utilisateurs",
        "Jetons MCP",
      ])
        expect(heading(name)).toBeNull();
    },
  );
});

/** The section « Adresse publique », found by its heading. */
function addressElement() {
  const section = screen
    .getByRole("heading", { name: "Adresse publique" })
    .closest("section");
  expect(section, "the heading must be inside a section").not.toBeNull();
  return section as HTMLElement;
}

async function addressSection() {
  await screen.findByRole("heading", { name: "Adresse publique" });
  return within(addressElement());
}

/** The deepest element of the section whose text holds `text`, wherever the page splits it. */
function elementHolding(text: string) {
  const found = [...addressElement().querySelectorAll("*")].filter(
    (el) =>
      el.textContent?.includes(text) &&
      ![...el.children].some((child) => child.textContent?.includes(text)),
  );
  expect(found, `an element of the section holds ${text}`).toHaveLength(1);
  return found[0] as Element;
}

const precedes = (node: Node, later: Node) =>
  Boolean(
    node.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

describe("Réglages, the section Adresse publique (decision 023 C)", () => {
  it("given an administrator, when /reglages loads, then the section shows the current address, a field and a save button", async () => {
    stubApi({ isAdmin: true, publicUrl: OLD_URL });

    renderAt("/reglages");

    const section = await addressSection();
    await waitFor(() =>
      expect(addressElement().textContent).toContain(OLD_URL),
    );
    expect(section.getByRole("textbox")).toBeDefined();
    expect(section.getByRole("button", { name: /Enregistrer/ })).toBeDefined();
  });

  it("given an address typed, when the section is read, then before the save button it links to the settings of the App and gives the callback and webhook addresses built on what is typed", async () => {
    stubApi({ isAdmin: true, publicUrl: OLD_URL });
    renderAt("/reglages");
    const section = await addressSection();
    const field = await section.findByRole("textbox");

    fireEvent.change(field, { target: { value: NEW_URL } });

    const link = await section.findByRole("link", {
      name: (_name, element) => element.getAttribute("href") === APP_SETTINGS,
    });
    const callback = elementHolding(`${NEW_URL}/api/auth/callback`);
    const webhook = elementHolding(`${NEW_URL}/api/webhooks/github`);
    const save = section.getByRole("button", { name: /Enregistrer/ });
    expect(precedes(link, save)).toBe(true);
    expect(precedes(callback, save)).toBe(true);
    expect(precedes(webhook, save)).toBe(true);
    // Not a constant: the steps follow the typed address.
    fireEvent.change(field, { target: { value: "https://other.example.net" } });
    expect(addressElement().textContent).toContain(
      "https://other.example.net/api/auth/callback",
    );
    expect(addressElement().textContent).toContain(
      "https://other.example.net/api/webhooks/github",
    );
    expect(addressElement().textContent).not.toContain(
      `${NEW_URL}/api/auth/callback`,
    );
  });

  it("given the section, when it is read, then it says that a connector added on claude.ai with the old address must be added again", async () => {
    stubApi({ isAdmin: true, publicUrl: OLD_URL });

    renderAt("/reglages");

    const section = await addressSection();
    await section.findByRole("textbox");
    const text = addressElement().textContent;
    expect(text).toMatch(/connecteur/i);
    expect(text).toMatch(/claude\.ai/);
    expect(text).toMatch(/ancienne adresse/i);
    expect(text).toMatch(/rajout|ajout/i);
  });

  it("given a new address typed with a path, when the button is clicked, then PUT /api/settings/public-url is sent with it and the section then shows the new address instead of the old one", async () => {
    const calls = stubApi({ isAdmin: true, publicUrl: OLD_URL });
    renderAt("/reglages");
    const section = await addressSection();
    await waitFor(() =>
      expect(addressElement().textContent).toContain(OLD_URL),
    );

    fireEvent.change(section.getByRole("textbox"), {
      target: { value: `${NEW_URL}/ignored/` },
    });
    fireEvent.click(section.getByRole("button", { name: /Enregistrer/ }));

    await waitFor(() =>
      expect(
        calls.filter(
          (c) => c.method === "PUT" && c.path === "/api/settings/public-url",
        ),
      ).toHaveLength(1),
    );
    const put = calls.find((c) => c.method === "PUT");
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      publicUrl: `${NEW_URL}/ignored/`,
    });
    await waitFor(() =>
      expect(addressElement().textContent).not.toContain(OLD_URL),
    );
    expect(addressElement().textContent).toContain(NEW_URL);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("given the server refuses the address with a 400, when the button is clicked, then an alert shows its French message and the current address stays", async () => {
    stubApi({
      isAdmin: true,
      publicUrl: OLD_URL,
      putAnswer: Response.json({ error: HTTPS_ONLY }, { status: 400 }),
    });
    renderAt("/reglages");
    const section = await addressSection();
    await waitFor(() =>
      expect(addressElement().textContent).toContain(OLD_URL),
    );

    fireEvent.change(section.getByRole("textbox"), {
      target: { value: "http://cockpit.example.com" },
    });
    fireEvent.click(section.getByRole("button", { name: /Enregistrer/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(HTTPS_ONLY);
    expect(addressElement().textContent).toContain(OLD_URL);
  });
});
