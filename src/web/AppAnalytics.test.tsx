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

// Decision 082, criteria 1, 4 and 6 seen from the page: posthog-js is loaded and started only when /api/me carries `analytics`, and reset at logout.
const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthog }));

import { App } from "./App.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

function open(analytics: unknown) {
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
        return Response.json({ configured: true, hasAdmin: true });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({
          login: "dorian",
          name: "Dorian",
          avatarUrl: null,
          isAdmin: false,
          analytics,
        });
      if (path === "/api/auth/logout")
        return new Response(null, { status: 204 });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  window.history.replaceState({}, "", "/reglages");
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

describe("the page and PostHog (decision 082)", () => {
  it("given /api/me with analytics null, when the page opens, then PostHog is never initialised (criterion 1)", async () => {
    open(null);

    await screen.findByRole("button", { name: /déconnecter/i });

    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("given /api/me with analytics, when the page opens, then PostHog is initialised with the key and host and the person identified (criterion 4)", async () => {
    open({
      key: "phc_test",
      host: "https://eu.i.posthog.com",
      distinctId: "7",
    });

    await waitFor(() => expect(posthog.identify).toHaveBeenCalledWith("7"));
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "https://eu.i.posthog.com",
        persistence: "memory",
      }),
    );
  });

  it("given a measured person, when she logs out, then posthog.reset() is called (criterion 6)", async () => {
    open({
      key: "phc_test",
      host: "https://eu.i.posthog.com",
      distinctId: "7",
    });
    await waitFor(() => expect(posthog.identify).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /déconnecter/i }));

    await waitFor(() => expect(posthog.reset).toHaveBeenCalledTimes(1));
  });
});
