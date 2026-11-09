// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice 15.2 (decision 072 I, S56): « Cockpit ne répond plus » is a banner of the shell, on every page, with the time of
// the last answer of /api/health and « Réessayer ». It replaces ServerAlert on the home; the login screen is not asked.

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

/** A fake server; `health.up` switches /api/health between its answer and a network failure. */
function stubApi() {
  const health = { up: false, calls: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(raw, "http://localhost").pathname;
      void init;
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          hasAdmin: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health") {
        health.calls += 1;
        if (!health.up) throw new TypeError("Failed to fetch");
        return Response.json({ status: "ok", version: "0.1.0" });
      }
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
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  return health;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

/** The role=alert element holding the text (the page may show other alerts of its own). */
async function alertSaying(text: RegExp) {
  const found = (await screen.findByText(text)).closest('[role="alert"]');
  expect(found, "the text is inside a role=alert").not.toBeNull();
  return found as HTMLElement;
}

describe("« Cockpit ne répond plus » (decision 072 I)", () => {
  it("given /api/health fails, when a page other than the home loads, then the alert banner says Cockpit ne répond plus and offers Réessayer", async () => {
    stubApi();

    renderAt("/reglages");

    const banner = await alertSaying(/Cockpit ne répond plus/);
    expect(banner.textContent).toContain("toutes les 10 secondes");
    expect(
      banner.querySelector("button")?.textContent?.trim(),
      "the retry button",
    ).toBe("Réessayer");
  });

  it("given /api/health answered at 9 h 42 then fails, when the page is shown again, then the banner says what the user sees dates from 9 h 42", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 9, 9, 42, 0));
    const health = stubApi();
    health.up = true;
    renderAt("/reglages");
    await waitFor(() => expect(health.calls).toBeGreaterThan(0));
    expect(screen.queryByRole("alert")).toBeNull();

    vi.setSystemTime(new Date(2026, 10, 9, 9, 50, 0));
    health.up = false;
    document.dispatchEvent(new Event("visibilitychange"));

    const banner = await alertSaying(/Cockpit ne répond plus/);
    expect(banner.textContent).toMatch(/9\s?(h|:)\s?42/);
  });
});
