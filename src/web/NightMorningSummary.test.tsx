// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubNight } from "./test-night.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 14.7 (decision 070), moved to /nuit by decision 084 E: the morning block. Pinned where the decision leaves room:
// - night = { id, startsAt, endsAt, delivered, total, workSeconds, criteriaProven, failures, items: [{ storyId, iWant, outcome, startedAt, finishedAt }] };
// - « US n » is the story id; the box is the element whose own text is « ✓ US 45 » (or ✦ / ✕) and it carries style.left and style.width in %;
// - a graduation is an element whose text is exactly « 22 h »; the row of a story is its <li>.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

/** An instant of the night of 8 to 9 November, in the browser's time zone (day 8 or 9). */
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();
const item = (
  storyId: number,
  outcome: string | null,
  run: [string, string] | null = null,
) => ({
  storyId,
  iWant: `faire la chose ${storyId}`,
  outcome,
  startedAt: run?.[0] ?? null,
  finishedAt: run?.[1] ?? null,
});
const show = (items: ReturnType<typeof item>[], summary = {}) => {
  const night = {
    id: 1,
    startsAt: local(8, 22),
    endsAt: local(9, 7),
    delivered: 1,
    total: items.length,
    workSeconds: 0,
    criteriaProven: 0,
    failures: 0,
    ...summary,
    items,
  };
  stubNight({ home: { night } });
  renderAt("/nuit");
};
const block = async () => {
  const found = (
    await screen.findByRole("heading", { name: /Cette nuit, Claude/ })
  ).closest("section");
  if (!found) throw new Error("no <section> around « Cette nuit »");
  return within(found);
};
// The line of a story in the outcome groups (decision 084 E3): the <li> of its link « US n · … ».
const row = async (storyId: number) => {
  const found = (await block())
    .getByRole("link", { name: new RegExp(`^US ${storyId} ·`) })
    .closest("li");
  if (!found) throw new Error("no row");
  return found;
};
const box = async (label: string) =>
  (await block()).getByText(label) as HTMLElement;

describe("slice 14.7: the summary of the night", () => {
  it.each([
    [
      { workSeconds: 7800, criteriaProven: 21, failures: 0 },
      [
        ["Travail", "2 h 10"],
        ["Critères prouvés", "21"],
        ["Échecs", "aucun"],
      ],
    ],
    [
      { workSeconds: 7800, criteriaProven: 1, failures: 2 },
      [
        ["Critères prouvés", "1"],
        ["Échecs", "2"],
      ],
    ],
  ])(
    "given the summary %j, when the page shows, then the boxes say %j",
    async (summary, boxes) => {
      show([item(45, "pr")], summary);

      for (const [label, value] of boxes)
        expect(
          (await (await block()).findByText(label as string)).parentElement
            ?.textContent,
        ).toContain(value);
    },
  );
});

describe("slice 14.7: the frise", () => {
  it("given a night from 22 h to 7 h, when the page shows, then the frise has one graduation per hour, 22 h to 7 h", async () => {
    show([item(45, "pr", [local(8, 22), local(8, 23)])]);

    await block();
    const ticks = (await block()).getAllByText(/^\d{1,2} h$/);
    expect(ticks.map((t) => t.textContent)).toEqual(
      [22, 23, 0, 1, 2, 3, 4, 5, 6, 7].map((h) => `${h} h`),
    );
  });

  it("given a run from 22 h 00 to 23 h 30 on a night of 9 h, when the page shows, then its box starts at 0% and is about 16.67% wide, and its line says 22 h 00 → 23 h 30", async () => {
    show([item(45, "pr", [local(8, 22), local(8, 23, 30)])]);

    const found = await box("✓ US 45");
    expect(found.style.left).toBe("0%");
    expect(Number.parseFloat(found.style.width)).toBeCloseTo(16.67, 1);
    expect((await row(45)).textContent).toContain("22 h 00 → 23 h 30");
  });

  it("given a run finished at 7 h 30, when the page shows, then the axis reaches 7 h 30 and no box goes past 100%", async () => {
    show([
      item(45, "pr", [local(8, 22), local(8, 23, 30)]),
      item(46, "pr", [local(9, 6), local(9, 7, 30)]),
    ]);

    const first = await box("✓ US 45");
    const last = await box("✓ US 46");
    expect(Number.parseFloat(first.style.width)).toBeCloseTo(15.79, 1);
    const end =
      Number.parseFloat(last.style.left) + Number.parseFloat(last.style.width);
    expect(end).toBeCloseTo(100, 1);
  });

  it("given a paused story and a skipped one without run, when the page shows, then the paused story has a ✦ box and sits in « En pause : attend ta réponse », the skipped one has no box and sits in « Sautées ou non lancées »", async () => {
    show([item(46, "paused"), item(47, "skipped")]);

    expect(await box("✦ US 46")).toBeTruthy();
    await row(46);
    expect(
      (await block()).getByText(/En pause : attend ta réponse/),
    ).toBeTruthy();
    expect((await block()).queryByText(/[✓✦✕] US 47/)).toBeNull();
    await row(47);
    expect((await block()).getByText(/Sautées ou non lancées/)).toBeTruthy();
  });

  it("given three stories whose last finished run ends at 4 h 10, when the page shows, then « fini à 4 h 10 » appears once", async () => {
    show([
      item(45, "pr", [local(9, 0), local(9, 2)]),
      item(46, "pr", [local(9, 2), local(9, 4, 10)]),
      item(47, "pr", [local(8, 22), local(8, 23)]),
    ]);

    await block();
    expect((await block()).getAllByText(/fini à/)).toHaveLength(1);
    expect((await block()).getByText(/fini à 4 h 10/)).toBeTruthy();
  });
});
