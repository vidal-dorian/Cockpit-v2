// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

// Decision 024 E. GET /api/history gives an `event` field on the receive_webhook entries (see webhooks.test.ts), and the row
// reads « Webhook reçu » and the event name, never the internal action code.
describe("Journal page, the webhook deliveries", () => {
  it("given a receive_webhook entry for the event issues, when /journal loads, then its row reads « Webhook reçu » and issues, and never receive_webhook", async () => {
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
        if (path === "/api/me")
          return Response.json({
            login: "octocat",
            name: null,
            avatarUrl: null,
          });
        if (path === "/api/history")
          return Response.json({
            entries: [
              {
                id: 1,
                at: "2026-10-30T12:00:00.000Z",
                actor: "github",
                origin: "webhook",
                action: "receive_webhook",
                result: "ok",
                event: "issues",
              },
            ],
          });
        throw new Error(`Unexpected fetch ${raw}`);
      }),
    );
    window.history.replaceState({}, "", "/journal");

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <App />
      </QueryClientProvider>,
    );

    const label = await screen.findByText(/Webhook reçu/);
    const row = label.closest("li");
    expect(row?.textContent).toContain("issues");
    expect(row?.textContent).not.toContain("receive_webhook");
  });
});
