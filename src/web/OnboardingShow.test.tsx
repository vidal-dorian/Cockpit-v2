// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Ticket 50: Réglages, Préférences has the button « Réafficher le guide de mise en route »; it POSTs /api/me/onboarding/show,
// after which the home shows the guide again (GET /api/home answers `onboarding` again).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const STEPS = {
  steps: [
    {
      key: "project",
      done: true,
      detail: "hello",
      projectId: null,
      storyId: null,
    },
    { key: "claude", done: false, detail: null, projectId: 5, storyId: null },
    { key: "prepare", done: false, detail: null, projectId: 5, storyId: null },
    { key: "idea", done: false, detail: null, projectId: 5, storyId: null },
    { key: "validate", done: false, detail: null, projectId: 5, storyId: null },
    { key: "develop", done: false, detail: null, projectId: 5, storyId: null },
  ],
};

function stub() {
  const api = stubShell({ onboarding: null } as never);
  const inner = globalThis.fetch;
  const shown: string[] = [];
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
      const method = (init?.method ?? "GET").toUpperCase();
      if (path === "/api/installation")
        return Response.json({ installed: true, installUrl: "https://x" });
      if (path === "/api/me/notifications")
        return Response.json({
          question: true,
          runFailed: true,
          prReady: true,
          nightRecap: true,
          quietStartHour: 22,
          quietEndHour: 7,
        });
      if (path === "/api/me/onboarding/show" && method === "POST") {
        shown.push(path);
        (api.state.home as Record<string, unknown>).onboarding = STEPS;
        return Response.json({ ok: true });
      }
      return inner(input, init);
    }),
  );
  return { shown };
}

describe("ticket 50: the getting-started guide can come back", () => {
  it("given the guide hidden, when the user opens Préférences, then the button « Réafficher le guide de mise en route » is there", async () => {
    stub();
    renderAt("/reglages/preferences");

    expect(
      await screen.findByRole("button", {
        name: "Réafficher le guide de mise en route",
      }),
    ).toBeDefined();
  });

  it("given the user clicks the button, when they go back to the home, then the guide is on top with its done steps ticked", async () => {
    const { shown } = stub();
    renderAt("/reglages/preferences");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Réafficher le guide de mise en route",
      }),
    );
    await waitFor(() => expect(shown).toHaveLength(1));

    cleanup();
    renderAt("/");

    const section = (
      await screen.findByRole("heading", { name: /Mise en route/ })
    ).closest("section") as HTMLElement;
    expect(section.querySelector("li")?.textContent).toContain("fait");
  });
});
