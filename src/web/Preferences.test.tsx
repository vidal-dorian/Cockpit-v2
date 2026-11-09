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

// Slice 15.2 (decision 072 D, H): the tab Préférences of Réglages, with the card « Notifications sur le téléphone » (S47).
//
// Pinned choices:
// - the tab is a link « Préférences » of the nav « Réglages », to /reglages/preferences; the page has the heading « Préférences »;
// - GET and PUT /api/me/notifications { question, runFailed, prReady, nightRecap, quietStartHour, quietEndHour }; a switch
//   sends a PUT whose JSON body holds the changed field (alone or with the others);
// - the four switches are role switch (or checkbox) named « Claude pose une question », « Un run échoue »,
//   « Une PR est prête à relire », « Le récap de la nuit »; the quiet hours are two controls labelled « Début du silence »
//   and « Fin du silence » whose value is the hour ("22", "7");
// - the buttons « Activer sur cet appareil » and « Envoyer une notification de test » appear when `PushManager` exists
//   (the test also gives navigator.serviceWorker); without it, on an iPhone, the text of decision 072 H replaces the first.

type Call = { method: string; path: string; body: string };

const NOTIFICATIONS = {
  question: true,
  runFailed: true,
  prReady: true,
  nightRecap: true,
  quietStartHour: 22,
  quietEndHour: 7,
};
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

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

function stubApi() {
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
      calls.push({ method, path, body: String(init?.body ?? "") });
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
          isAdmin: false,
        });
      if (path === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
        });
      if (path === "/api/me/notifications")
        return Response.json(
          method === "PUT"
            ? { ...NOTIFICATIONS, ...JSON.parse(String(init?.body)) }
            : NOTIFICATIONS,
        );
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  return calls;
}

/** A browser that can push: the classes the card looks for. */
function pushCapable() {
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", class {});
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: new Promise(() => {}), register: vi.fn() },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(navigator, "userAgent");
  window.history.replaceState({}, "", "/");
});

const control = (name: RegExp) =>
  screen.queryByRole("switch", { name }) ??
  screen.getByRole("checkbox", { name });

describe("Réglages, Préférences (decision 072 D)", () => {
  it("given a user, when /reglages/preferences loads, then the nav links the tab and the card shows the four switches on, the quiet hours and the two buttons", async () => {
    stubApi();
    pushCapable();

    renderAt("/reglages/preferences");

    expect(
      await screen.findByRole("heading", { name: "Préférences" }),
    ).toBeDefined();
    const nav = await screen.findByRole("navigation", { name: "Réglages" });
    const tab = [...nav.querySelectorAll("a")].find(
      (a) => a.textContent?.trim() === "Préférences",
    );
    expect(tab?.getAttribute("href")).toBe("/reglages/preferences");
    expect(screen.getByText(/Notifications sur le téléphone/i)).toBeDefined();
    for (const name of [
      /Claude pose une question/,
      /Un run échoue/,
      /Une PR est prête à relire/,
      /Le récap de la nuit/,
    ])
      expect(
        (control(name) as HTMLInputElement).checked ??
          control(name).getAttribute("aria-checked") === "true",
        String(name),
      ).toBe(true);
    expect(
      (screen.getByLabelText("Début du silence") as HTMLInputElement).value,
    ).toBe("22");
    expect(
      (screen.getByLabelText("Fin du silence") as HTMLInputElement).value,
    ).toBe("7");
    expect(
      screen.getByRole("button", { name: "Activer sur cet appareil" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Envoyer une notification de test" }),
    ).toBeDefined();
  });

  it("given the card, when the user turns « Un run échoue » off, then a PUT /api/me/notifications sends runFailed false", async () => {
    const calls = stubApi();
    pushCapable();
    renderAt("/reglages/preferences");
    await screen.findByRole("heading", { name: "Préférences" });
    await screen.findByText(/Un run échoue/);

    fireEvent.click(control(/Un run échoue/));

    await waitFor(() =>
      expect(
        calls.filter(
          (c) => c.method === "PUT" && c.path === "/api/me/notifications",
        ),
      ).toHaveLength(1),
    );
    const put = calls.find((c) => c.method === "PUT");
    expect(JSON.parse(put?.body ?? "{}")).toMatchObject({ runFailed: false });
  });
});

describe("Réglages, Préférences on an iPhone (decision 072 H)", () => {
  it("given no PushManager and an iPhone, when the card shows, then it asks to add Cockpit to the home screen instead of offering « Activer sur cet appareil »", async () => {
    stubApi();
    vi.stubGlobal("PushManager", undefined);
    Reflect.deleteProperty(window, "PushManager");
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: IPHONE,
    });

    renderAt("/reglages/preferences");

    expect(
      await screen.findByText(/ajoute d'abord Cockpit à l'écran d'accueil/i),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Activer sur cet appareil" }),
    ).toBeNull();
  });
});
