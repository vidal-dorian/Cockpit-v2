// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Decision 083 C: when the account goes away (logout), PostHog forgets the identity.
const ph = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: ph }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("given a logged-in user 7, when /api/me then answers 401, then reset is called once", async () => {
  vi.resetModules();
  let loggedIn = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
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
      if (path === "/api/telemetry") return Response.json({ key: "phc_test" });
      if (path === "/api/me")
        return loggedIn
          ? Response.json({
              id: 7,
              login: "dorian",
              name: "Dorian",
              avatarUrl: null,
              isAdmin: false,
            })
          : Response.json({ error: "Unauthorized" }, { status: 401 });
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  const { App } = await import("./App.tsx");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  await screen.findByText("Dorian");
  // identify precedes the first $pageview, so no screen goes out as an anonymous visitor.
  await vi.waitFor(() => {
    expect(ph.identify).toHaveBeenCalledWith("7");
    expect(ph.capture).toHaveBeenCalledWith("$pageview", expect.anything());
  });
  const pageview = ph.capture.mock.calls.findIndex(
    ([event]) => event === "$pageview",
  );
  expect(ph.identify.mock.invocationCallOrder[0]).toBeLessThan(
    ph.capture.mock.invocationCallOrder[pageview] ?? 0,
  );
  expect(ph.reset).not.toHaveBeenCalled();

  loggedIn = false;
  await act(() => client.invalidateQueries({ queryKey: ["me"] }));

  await vi.waitFor(() => expect(ph.reset).toHaveBeenCalledTimes(1));
});
