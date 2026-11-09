// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 15.4, review fixes (decision 075 C): where « Faire » leads for steps 3, 5, 6 and 7.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const KEYS = ["project", "claude", "prepare", "idea", "validate", "develop"];
/** The first `done` steps are done; the next one has a project and a story to lead to. */
const guide = (done: number) => ({
  steps: KEYS.map((key, i) => ({
    key,
    done: i < done,
    detail: null,
    projectId: 5,
    storyId: 21,
  })),
});

function stub(onboarding: unknown) {
  stubShell({
    onboarding,
    projects: [{ ...PROJECT, state: "idle" }],
  } as Parameters<typeof stubShell>[0]);
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (new URL(raw, "http://localhost").pathname === "/api/installation")
        return Response.json({ installed: true, installUrl: "https://x" });
      return inner(input, init);
    }),
  );
}

const faire = async () => {
  const heading = await screen.findByRole("heading", { name: /Mise en route/ });
  const section = heading.closest("section") as HTMLElement;
  return within(section).getByText("Faire");
};

describe("slice 15.4: the targets of « Faire »", () => {
  it.each([
    [1, "/reglages"],
    [4, "/us/21"],
    [5, "/us/21"],
  ])(
    "given %i steps done, when the guide shows, then Faire leads to %s",
    async (n, href) => {
      stub(guide(n));
      renderAt("/");

      expect((await faire()).getAttribute("href")).toBe(href);
    },
  );

  it("given the idea step next, when the user clicks Faire, then the idea panel opens", async () => {
    stub(guide(3));
    renderAt("/");

    fireEvent.click(await faire());

    expect(
      await screen.findByRole("dialog", { name: "Noter une idée" }),
    ).toBeTruthy();
  });

  it("given the idea step next and no active project, when the guide shows, then Faire is a link to /projets", async () => {
    stub({
      steps: guide(3).steps.map((s) => ({ ...s, projectId: null })),
    });
    renderAt("/");

    expect((await faire()).getAttribute("href")).toBe("/projets");
  });

  it("given the hide is refused, when the user clicks « Masquer ce guide », then an alert says so and the guide stays", async () => {
    stub(guide(3));
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
        String(input).includes("/api/me/onboarding/hide")
          ? Response.json({ error: "x" }, { status: 500 })
          : inner(input, init),
      ),
    );
    renderAt("/");
    await faire();

    fireEvent.click(screen.getByRole("button", { name: "Masquer ce guide" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "n'a pas pu être masqué",
    );
    expect(screen.getByRole("heading", { name: /Mise en route/ })).toBeTruthy();
  });
});
