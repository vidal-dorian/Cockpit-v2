// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Decision 024 F: the fifth line of the health check, « Webhook de Cockpit ».
//
// Pinned choices (the decision leaves them open):
// - The label is exactly « Webhook de Cockpit », after the four others, with OK / À corriger in text like the others.
// - One French sentence per red code, with these words: wrong_url says « adresse du webhook »; last_delivery_failed says
//   « dernière livraison » and « échoué »; unknown says « impossible » and « GitHub ». No internal code is ever shown.

type Line = { key: string; ok: boolean; detail: string };

const FOUR: Line[] = [
  { key: "claude_md", ok: true, detail: "ok" },
  { key: "ci", ok: true, detail: "ok" },
  { key: "mcp", ok: true, detail: "ok" },
  { key: "agents", ok: true, detail: "ok" },
];
const LABEL = "Webhook de Cockpit";
const GREEN = /\bOK\b/;
const RED = /À corriger/;

function stubHealth(webhook: Line) {
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
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/projects" && method === "GET")
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: false,
            },
          ],
        });
      if (path === "/api/projects/5/health")
        return Response.json({ lines: [...FOUR, webhook] });
      if (/^\/api\/projects\/[^/]+\/stories$/.test(path))
        return Response.json({ stories: [] });
      if (/^\/api\/projects\/[^/]+\/tickets$/.test(path))
        return Response.json({ tickets: [] });
      if (path === "/api/me/routine")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      if (/^\/api\/projects\/[^/]+\/routine$/.test(path))
        return Response.json({
          frequency: "off",
          hour: null,
          weekday: null,
          timeZone: "Europe/Paris",
          nextRunAt: null,
          lastRun: null,
        });
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
}

function renderProject() {
  window.history.replaceState({}, "", "/projets/5");
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

const rowOf = (text: string) => {
  const row = screen.getByText(text).closest("li, tr");
  expect(row, `${text} must be inside a list item or a row`).not.toBeNull();
  return row as HTMLElement;
};

describe("Project page, the webhook line (decision 024 F)", () => {
  it("given the webhook line is ok, when the page loads, then « Webhook de Cockpit » reads OK, after the Agents line", async () => {
    stubHealth({ key: "webhook", ok: true, detail: "ok" });

    renderProject();

    await screen.findByText(LABEL);
    const row = rowOf(LABEL);
    expect(within(row).getByText(GREEN)).toBeDefined();
    expect(within(row).queryByText(RED)).toBeNull();
    expect(
      rowOf("Agents et skill de développement").compareDocumentPosition(row) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    ["wrong_url", [/adresse du webhook/i]],
    ["last_delivery_failed", [/dernière livraison/i, /échoué/i]],
    ["unknown", [/impossible/i, /GitHub/]],
  ])(
    "given the webhook line is red %s, when the page loads, then the line reads À corriger with a French sentence and no internal code",
    async (detail, words) => {
      stubHealth({ key: "webhook", ok: false, detail });

      renderProject();

      await screen.findByText(LABEL);
      const row = rowOf(LABEL);
      expect(within(row).getByText(RED)).toBeDefined();
      expect(within(row).queryByText(GREEN)).toBeNull();
      for (const word of words) expect(row.textContent).toMatch(word);
      expect(row.textContent).not.toMatch(
        /wrong_url|last_delivery_failed|unknown/,
      );
    },
  );
});
