// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeData } from "./test-home.tsx";
import { PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 15.4 (decision 075 C to F). Pinned: GET /api/home answers `onboarding: null | { steps }`, six steps (S06 steps 2 to 7)
//   { key: "project" | "claude" | "prepare" | "idea" | "validate" | "develop", done, detail: string | null, projectId: number | null, storyId: number | null };
// step 1 (« Ouvrir des repos à Cockpit ») is `installed` of GET /api/installation.
// The section is the <section> of the <h2> « Mise en route · N sur 7 »; a done step reads « fait » for screen readers;
// « Faire » is a link: step 1 /bienvenue, 2 /projets, 3 /reglages, 4 /projets/{projectId}.
// « Masquer ce guide » POSTs /api/me/onboarding/hide.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const step = (key: string, done: boolean, detail: string | null = null) => ({
  key,
  done,
  detail,
  projectId: done ? null : 5,
  storyId: null,
});
/** Steps 2 and 3 done (with step 1 from /api/installation: 3 sur 7). */
const THREE = {
  steps: [
    step("project", true, "hello"),
    step("claude", true, "claude.ai"),
    step("prepare", false),
    step("idea", false),
    step("validate", false),
    step("develop", false),
  ],
};
const ONE_LEFT = {
  steps: THREE.steps.map((s) => ({ ...s, done: s.key !== "develop" })),
};
const question = {
  kind: "answer",
  questionId: 7,
  question: "Quel nom ?",
  suggestedAnswers: ["A"],
  runId: 12,
  storyId: 21,
  iWant: "x",
  project: PROJECT,
};

/** The shell fake, with the guide in the home, /api/installation and the hide POST. */
function stub(
  onboarding: unknown,
  over: Partial<HomeData> = {},
  installed = true,
) {
  const api = stubShell({ ...over, onboarding } as Partial<HomeData>);
  const inner = globalThis.fetch;
  const hidden: string[] = [];
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
        return Response.json({ installed, installUrl: "https://x" });
      if (path === "/api/me/onboarding/hide" && method === "POST") {
        hidden.push(path);
        (api.state.home as Record<string, unknown>).onboarding = null;
        return Response.json({ ok: true });
      }
      return inner(input, init);
    }),
  );
  return { api, hidden };
}

const h1 = async () =>
  (await screen.findByRole("heading", { level: 1 })).textContent ?? "";
const guide = async (name = /Mise en route/) =>
  (await screen.findByRole("heading", { name })).closest(
    "section",
  ) as HTMLElement;

describe("slice 15.4: the getting-started guide on the home", () => {
  it("given steps 1 to 3 done, when the home loads, then it shows « Mise en route · 3 sur 7 » with the seven steps, the done ones marked, Faire on the first one left and Pourquoi cet ordre", async () => {
    stub(THREE);
    renderAt("/");

    const section = await guide(/Mise en route\s*·\s*3 sur 7/);
    const items = Array.from(section.querySelectorAll("li"));
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Ouvrir des repos à Cockpit"),
      expect.stringContaining("Importer un premier projet"),
      expect.stringContaining("Connecter Claude"),
      expect.stringContaining("Préparer un repo pour Claude"),
      expect.stringContaining("Noter une première idée"),
      expect.stringContaining("Valider une user story"),
      expect.stringContaining("Développer avec Claude"),
    ]);
    for (const li of items.slice(0, 3))
      expect(li.textContent).toContain("fait");
    for (const li of items.slice(3))
      expect(li.textContent).not.toContain("fait");
    const faire = screen.getAllByRole("link", { name: "Faire" });
    expect(faire).toHaveLength(1);
    expect(items[3]?.contains(faire[0] as Node)).toBe(true);
    // « Préparer pour Claude » lives on the project's Santé tab.
    expect(faire[0]?.getAttribute("href")).toBe("/projets/5/sante");
    expect(screen.getByText("Pourquoi cet ordre")).toBeTruthy();
    expect(
      screen.getByText(/Claude ne peut développer que dans un repo préparé/),
    ).toBeTruthy();
  });

  it("given the guide and nothing waiting, when the home loads, then the h1 is « Plus que 4 étapes avant ta première PR. »", async () => {
    stub(THREE);
    renderAt("/");

    await waitFor(async () =>
      expect(await h1()).toContain("Plus que 4 étapes avant ta première PR."),
    );
    expect(await h1()).toContain(
      "Chacune se coche toute seule quand elle est faite.",
    );
  });

  it("given the guide and one step left, when the home loads, then the h1 is « Plus qu'une étape avant ta première PR. »", async () => {
    stub(ONE_LEFT);
    renderAt("/");

    await waitFor(async () =>
      expect(await h1()).toContain("Plus qu'une étape avant ta première PR."),
    );
  });

  it("given the guide and a question waiting, when the home loads, then the h1 stays « Claude est bloqué sur 1 run. » and the guide is shown", async () => {
    stub(THREE, { forYou: [question] });
    renderAt("/");

    await guide();
    expect(await h1()).toContain("Claude est bloqué sur 1 run.");
    expect(await h1()).not.toContain("Plus que");
  });

  it("given the guide, when the user clicks « Masquer ce guide », then it POSTs the hide and the section goes", async () => {
    const { hidden } = stub(THREE);
    renderAt("/");
    await guide();

    fireEvent.click(screen.getByRole("button", { name: "Masquer ce guide" }));

    await waitFor(() => expect(hidden).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(/Mise en route/)).toBeNull());
  });

  it("given onboarding null, when the home loads, then there is no « Mise en route » section", async () => {
    stub(null);
    renderAt("/");

    await waitFor(async () =>
      expect(await h1()).toContain("Rien ne t'attend."),
    );
    expect(screen.queryByText(/Mise en route/)).toBeNull();
  });

  it("given the App not installed, when the home loads, then step 1 is not done and its Faire goes to /bienvenue", async () => {
    stub(THREE, {}, false);
    renderAt("/");

    const section = await guide(/Mise en route\s*·\s*2 sur 7/);
    const first = section.querySelector("li");
    expect(first?.textContent).toContain("Ouvrir des repos à Cockpit");
    expect(first?.textContent).not.toContain("fait");
    expect(first?.querySelector("a")?.getAttribute("href")).toBe("/bienvenue");
  });
});
