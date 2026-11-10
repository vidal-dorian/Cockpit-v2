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

// Slice 13.5 (decision 078 A to C, F, G; screen S50): Réglages › Données at /reglages/donnees and the fingerprint card of Instance. The contract with the
// server is the one of src/server/test-data.ts (GET /api/me/data, GET /api/me/export, DELETE /api/me, POST /api/settings/fingerprints/erase). Pinned labels:
// - the menu entry « Données » (after « Abonnement »); the state sentence is the heading « Ce que Cockpit garde sur toi. » ; the lines are rows named
//   « Compte », « Projets », « Journal », « Secrets », « Code de tes repos » (their label and their text in the same list item or row);
// - « Préparer l'export » fetches the export and saves it under the file name `cockpit-<login>-<YYYY-MM-DD>.json` (an anchor with `download`);
// - « Supprimer mon compte… » opens a dialog (role dialog) with the text of C, a textbox « Ton login GitHub » and a button « Supprimer définitivement »,
//   disabled until the login typed is exactly hers; it sends DELETE /api/me { login }, then the page shows « Se connecter avec GitHub »;
// - an administrator reads the sentence of G instead of the button; Instance gets a section « Effacer l'empreinte d'un compte supprimé » with a textbox
//   « @login GitHub » and a button « Effacer l'empreinte », answering « Empreinte effacée. » or « Aucune empreinte pour ce compte. ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

type Call = { method: string; path: string; body: unknown };

function stub(
  options: {
    isAdmin?: boolean;
    analytics?: { key: string; host: string; distinctId: string } | null;
    answers?: Record<string, () => Response>;
  } = {},
) {
  const calls: Call[] = [];
  let signedIn = true;
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
      const text = typeof init?.body === "string" ? init.body : "";
      calls.push({ method, path, body: text ? JSON.parse(text) : undefined });
      if (method === "DELETE" && path === "/api/me") {
        signedIn = false;
        return Response.json({ ok: true });
      }
      const answer = options.answers?.[`${method} ${path}`];
      if (answer) return answer();
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return signedIn
          ? Response.json({
              login: "dorian",
              name: "Dorian",
              avatarUrl: null,
              isAdmin: options.isAdmin === true,
              analytics: options.analytics ?? null,
            })
          : Response.json({ error: "Unauthorized" }, { status: 401 });
      if (path === "/api/me/data")
        return Response.json({
          name: "Dorian",
          login: "dorian",
          isAdmin: options.isAdmin === true,
          projects: 14,
          tickets: 30,
          stories: 40,
          runs: 50,
          questions: 6,
          journal: 8,
          tokens: 2,
          shared: [
            { id: 1, fullName: "dorian/app", members: ["marie", "karim"] },
          ],
        });
      if (path === "/api/me/export")
        return Response.json({ account: { login: "dorian" } });
      if (path === "/api/installation")
        return Response.json({ installed: true, installUrl: "https://x" });
      if (path === "/api/me/plan")
        return Response.json({
          plan: "free",
          via: null,
          until: null,
          repos: 1,
          limit: 3,
        });
      if (path === "/api/settings/users") return Response.json({ users: [] });
      if (path === "/api/settings/pro-codes")
        return Response.json({ codes: [] });
      if (path === "/api/settings/fingerprints/erase")
        return Response.json({ ok: true });
      if (path === "/api/projects") return Response.json({ projects: [] });
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

// The shell's navigation also says « Projets »: take the label whose row holds the value.
const rowOf = (label: string, value = "") => {
  const row = screen
    .getAllByText(label)
    .map((el) => el.closest("li, tr, div"))
    .find((el) => el?.textContent?.includes(value));
  expect(row, `${label} must sit in a row`).not.toBeNull();
  return within(row as HTMLElement);
};

describe("078 A: the page", () => {
  it("given the data, when /reglages/donnees opens, then the state sentence, the five lines with their counts and the sentence about what remains are shown", async () => {
    stub();

    renderAt("/reglages/donnees");

    await screen.findByRole("heading", {
      name: /Ce que Cockpit garde sur toi/,
    });
    await screen.findByText(/8 entrées/);
    screen.getByText("Et comment tout effacer.", { exact: false });
    expect(
      screen.getByRole("link", { name: "Données" }).getAttribute("href"),
    ).toBe("/reglages/donnees");
    expect(rowOf("Compte").getByText(/Dorian/)).toBeDefined();
    expect(rowOf("Compte").getByText(/@dorian/)).toBeDefined();
    expect(rowOf("Projets", "14").getByText(/14/)).toBeDefined();
    expect(rowOf("Journal").getByText(/8 entrées/)).toBeDefined();
    expect(
      rowOf("Journal").getByText(/gardées tant que le compte existe/),
    ).toBeDefined();
    expect(rowOf("Secrets").getByText(/jamais affichés/)).toBeDefined();
    expect(rowOf("Code de tes repos").getByText(/jamais copié/)).toBeDefined();
    screen.getByText(
      /Après une suppression, Cockpit garde seulement une empreinte de ton compte GitHub et le nombre de repos gratuits utilisés, pour qu'une suppression ne redonne pas 3 repos\. Demande à l'administrateur de l'effacer\./,
    );
  });
});

describe("082 E: the audience measure line", () => {
  it("given an instance with analytics, when Réglages › Données opens, then the line « Mesure d'audience » names the host only", async () => {
    stub({
      analytics: {
        key: "phc_test",
        host: "https://eu.i.posthog.com",
        distinctId: "7",
      },
    });

    renderAt("/reglages/donnees");

    await screen.findByRole("heading", {
      name: /Ce que Cockpit garde sur toi/,
    });
    const row = await screen.findByText("Mesure d'audience");
    const text = row.closest("li, tr, div")?.textContent ?? "";
    expect(text).toContain(
      "pages vues et clics, sans texte ni cookie · envoyés au PostHog de l'instance (eu.i.posthog.com)",
    );
    expect(text).not.toContain("https://");
    expect(text).not.toContain("phc_test");
  });

  it("given an instance without analytics, when Réglages › Données opens, then the line does not appear", async () => {
    stub({ analytics: null });

    renderAt("/reglages/donnees");

    await screen.findByText(/8 entrées/);
    expect(screen.queryByText("Mesure d'audience")).toBeNull();
  });
});

describe("078 B: the export", () => {
  it("given the page, when Préparer l'export is clicked, then the export is fetched and saved as cockpit-<login>-<date>.json", async () => {
    const calls = stub();
    const createObjectURL = vi.fn(() => "blob:export");
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    renderAt("/reglages/donnees");

    fireEvent.click(
      await screen.findByRole("button", { name: "Préparer l'export" }),
    );

    await waitFor(() => expect(names).toHaveLength(1));
    expect(names[0]).toMatch(/^cockpit-dorian-\d{4}-\d{2}-\d{2}\.json$/);
    expect(calls.filter((c) => c.path === "/api/me/export")).toHaveLength(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe("078 C: deleting the account", () => {
  it("given a shared project, when Supprimer mon compte… is clicked, then the window says what goes and for whom, and the button waits for the exact login", async () => {
    const calls = stub();
    renderAt("/reglages/donnees");

    fireEvent.click(
      await screen.findByRole("button", { name: "Supprimer mon compte…" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        /dorian\/app sera supprimé pour @marie, @karim\./,
      ),
    ).toBeDefined();
    const confirm = within(dialog).getByRole("button", {
      name: "Supprimer définitivement",
    });
    const field = within(dialog).getByRole("textbox", {
      name: "Ton login GitHub",
    });
    fireEvent.change(field, { target: { value: "dori" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([]);
    fireEvent.change(field, { target: { value: "dorian" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it("given the login typed, when the deletion is confirmed, then DELETE /api/me is sent with it and the page goes back to the sign-in", async () => {
    const calls = stub();
    renderAt("/reglages/donnees");
    fireEvent.click(
      await screen.findByRole("button", { name: "Supprimer mon compte…" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Ton login GitHub" }),
      { target: { value: "dorian" } },
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Supprimer définitivement" }),
    );

    await screen.findByText("Se connecter avec GitHub");
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/api/me", body: { login: "dorian" } },
    ]);
  });
});

describe("078 G: the administrator", () => {
  it("given an administrator, when the page opens, then the sentence explains why and there is no deletion button", async () => {
    stub({ isAdmin: true });

    renderAt("/reglages/donnees");

    await screen.findByText(
      "Tu administres cette instance : ton compte ne peut pas être supprimé ici.",
    );
    expect(
      screen.queryByRole("button", { name: "Supprimer mon compte…" }),
    ).toBeNull();
    screen.getByRole("button", { name: "Préparer l'export" });
  });
});

describe("078 F: erasing a fingerprint", () => {
  it("given the Instance page, when the administrator erases a login, then it is posted and confirmed", async () => {
    const calls = stub({ isAdmin: true });
    renderAt("/reglages/utilisateurs");
    await screen.findByRole("heading", {
      name: "Effacer l'empreinte d'un compte supprimé",
    });

    fireEvent.change(screen.getByRole("textbox", { name: "@login GitHub" }), {
      target: { value: "marie" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Effacer l'empreinte" }),
    );

    await screen.findByText("Empreinte effacée.");
    expect(
      calls.filter((c) => c.path === "/api/settings/fingerprints/erase"),
    ).toEqual([
      {
        method: "POST",
        path: "/api/settings/fingerprints/erase",
        body: { login: "marie" },
      },
    ]);
  });

  it("given no fingerprint for the account, when it is erased, then « Aucune empreinte pour ce compte. » is shown", async () => {
    stub({
      isAdmin: true,
      answers: {
        "POST /api/settings/fingerprints/erase": () =>
          Response.json({ error: "no_fingerprint" }, { status: 404 }),
      },
    });
    renderAt("/reglages/utilisateurs");

    fireEvent.change(
      await screen.findByRole("textbox", { name: "@login GitHub" }),
      { target: { value: "marie" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Effacer l'empreinte" }),
    );

    await screen.findByText("Aucune empreinte pour ce compte.");
  });
});
