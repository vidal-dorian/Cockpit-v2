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

// Decision 072 F, I: logging out frees the device (its push subscription) and empties the offline copies of the service worker.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "caches");
  window.history.replaceState({}, "", "/");
});

describe("logout (decision 072)", () => {
  it("given a subscribed device, when the user logs out, then the subscription is deleted on the server and in the browser, and the cache is emptied", async () => {
    const calls: string[] = [];
    const unsubscribe = vi.fn(async () => true);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({
              endpoint: "https://push.example.com/send/1",
              unsubscribe,
            }),
          },
        }),
      },
    });
    const deleteCache = vi.fn(async () => true);
    Object.defineProperty(window, "caches", {
      configurable: true,
      value: { delete: deleteCache },
    });
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
        calls.push(`${init?.method ?? "GET"} ${path} ${init?.body ?? ""}`);
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
          });
        if (path === "/api/auth/logout" || path === "/api/push/subscriptions")
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

    fireEvent.click(
      await screen.findByRole("button", { name: /déconnecter/i }),
    );

    await waitFor(() => expect(deleteCache).toHaveBeenCalledWith("cockpit-v1"));
    expect(unsubscribe).toHaveBeenCalled();
    const delIndex = calls.findIndex((c) =>
      c.startsWith("DELETE /api/push/subscriptions"),
    );
    const outIndex = calls.findIndex((c) =>
      c.startsWith("POST /api/auth/logout"),
    );
    expect(delIndex).toBeGreaterThanOrEqual(0);
    expect(delIndex).toBeLessThan(outIndex);
    expect(calls[delIndex]).toContain("https://push.example.com/send/1");
  });
});
