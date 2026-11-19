// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 083 D1 to D3: the lighter home on the phone. jsdom has no layout, so the responsive rules are asserted on the classes.
// Pinned: below md the guide's rows other than the next one, « Pourquoi cet ordre » and « Dernièrement » carry `max-md:hidden`;
// the « Voir les 7 étapes » button carries `md:hidden` and `aria-expanded`, and unfolding removes `max-md:hidden`;
// in a « 2 · Ensuite » row the title is not `truncate` below sm (`max-sm:line-clamp-2`) and the actions sit under it (`max-sm:col-start-2`).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const step = (key: string, done: boolean) => ({
  key,
  done,
  detail: done ? "ok" : null,
  projectId: done ? null : 5,
  storyId: null,
});
const GUIDE = {
  steps: [
    step("project", true),
    step("claude", true),
    step("prepare", false),
    step("idea", false),
    step("validate", false),
    step("develop", false),
  ],
};
const validate = {
  kind: "validate",
  storyId: 22,
  iWant: "trier les exports par date de création",
  project: PROJECT,
};

/** The shell fake with the guide in the home and /api/installation. */
function stub(over: Record<string, unknown> = {}) {
  stubShell({ onboarding: GUIDE, ...over } as never);
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

const guideSection = async () =>
  (await screen.findByRole("heading", { name: /Mise en route/ })).closest(
    "section",
  ) as HTMLElement;
const items = (s: HTMLElement) => Array.from(s.querySelectorAll("li"));
const why = (s: HTMLElement) =>
  Array.from(s.querySelectorAll("p")).filter((p) =>
    /Claude ne peut développer|Pourquoi cet ordre/.test(p.textContent ?? ""),
  );

describe("decision 083 D1: the guide on the phone", () => {
  it("given the guide with four steps left, when the home loads, then only the next step stays visible below md and the other six carry max-md:hidden", async () => {
    stub();
    renderAt("/");

    const rows = items(await guideSection());
    expect(rows).toHaveLength(7);
    // install, project and claude are done in the fixture: the next step is « Préparer un repo pour Claude ».
    expect(rows.map((li) => li.className.includes("max-md:hidden"))).toEqual([
      true,
      true,
      true,
      false,
      true,
      true,
      true,
    ]);
    expect(rows[3]?.textContent).toContain("Faire");
  });

  it("given the guide, when the home loads, then « Voir les 7 étapes » is a collapsed button shown only below md", async () => {
    stub();
    renderAt("/");

    const button = await screen.findByRole("button", {
      name: "Voir les 7 étapes",
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.className).toContain("md:hidden");
  });

  it("given the collapsed guide, when « Voir les 7 étapes » is clicked, then every step and « Pourquoi cet ordre » show and the button reads « Masquer les étapes »", async () => {
    stub();
    renderAt("/");

    const section = await guideSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Voir les 7 étapes" }),
    );

    const button = screen.getByRole("button", { name: "Masquer les étapes" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    for (const li of items(section))
      expect(li.className).not.toContain("max-md:hidden");
    for (const p of why(section))
      expect(p.className).not.toContain("max-md:hidden");
  });

  it("given the unfolded guide, when « Masquer les étapes » is clicked, then the guide folds back to the next step", async () => {
    stub();
    renderAt("/");

    const section = await guideSection();
    fireEvent.click(
      await screen.findByRole("button", { name: "Voir les 7 étapes" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Masquer les étapes" }));

    expect(
      screen
        .getByRole("button", { name: "Voir les 7 étapes" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      items(section).filter((li) => li.className.includes("max-md:hidden")),
    ).toHaveLength(6);
  });

  it("given the folded guide, when it is read, then « Pourquoi cet ordre » and its text carry max-md:hidden", async () => {
    stub();
    renderAt("/");

    const ps = why(await guideSection());
    expect(ps).toHaveLength(2);
    for (const p of ps) expect(p.className).toContain("max-md:hidden");
  });

  it("given the guide, when it is read from md up, then it is whole as before: the button is the only thing that hides on md and nothing else hides the steps", async () => {
    stub();
    renderAt("/");

    const section = await guideSection();
    // `max-md:hidden` is the only rule that hides a step, so from md every step shows.
    for (const li of items(section))
      expect(li.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(
      screen.getAllByRole("link", { name: "Faire" }).length +
        screen.queryAllByRole("button", { name: "Faire" }).length,
    ).toBe(1);
  });
});

describe("decision 083 D2: Dernièrement on the phone", () => {
  it("given a journal entry, when the home loads, then the Dernièrement section carries max-md:hidden", async () => {
    stub({
      onboarding: null,
      history: {
        entries: [
          {
            id: 1,
            action: "story.validated",
            summary: "US validée",
            project: PROJECT,
            createdAt: "2026-11-17T10:00:00Z",
          },
        ],
        hasMore: false,
      },
    });
    renderAt("/");

    const section = (
      await screen.findByRole("heading", { name: "Dernièrement" })
    ).closest("section") as HTMLElement;
    expect(section.className).toContain("max-md:hidden");
  });
});

describe("decision 083 D3: a « 2 · Ensuite » row on the phone", () => {
  it("given a story to validate, when « 2 · Ensuite » shows it, then its title may take two lines below sm instead of truncating", async () => {
    stub({
      onboarding: null,
      forYou: [validate, { ...validate, storyId: 23 }],
    });
    renderAt("/");

    const next = (
      await screen.findByRole("heading", { name: /2 · Ensuite/ })
    ).closest("section") as HTMLElement;
    const title = (await screen.findAllByText(/trier les exports/))
      .map((el) => next.contains(el) && el.closest("b"))
      .find(Boolean) as HTMLElement;
    expect(title.className).toContain("max-sm:line-clamp-2");
    expect(title.className).toContain("sm:truncate");
    expect(title.className).not.toMatch(/(^|\s)truncate(\s|$)/);
  });

  it("given a story to validate, when « 2 · Ensuite » shows it, then its buttons sit under the text below sm and keep their place from sm", async () => {
    stub({
      onboarding: null,
      forYou: [validate, { ...validate, storyId: 23 }],
    });
    renderAt("/");

    const next = (
      await screen.findByRole("heading", { name: /2 · Ensuite/ })
    ).closest("section") as HTMLElement;
    const actions = (await screen.findAllByRole("button", { name: /Valider/ }))
      .map((b) => next.contains(b) && b.parentElement)
      .find(Boolean) as HTMLElement;
    expect(actions.className).toContain("max-sm:col-start-2");
  });
});
