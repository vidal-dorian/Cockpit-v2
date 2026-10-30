// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DecisionStory,
  decisionStory,
  stubDecisionApi,
} from "./test-decisions.tsx";
import { type Answer, fail, renderAt, story, ticket } from "./test-tickets.tsx";

// Decision 025 E, F, G (slice 5.2): the section « Issue modifiée sur GitHub » of /us/:id.
// Pinned shapes (the server tests of issue-diverged.test.ts and issue-resolve.test.ts pin the same):
// - GET /api/stories/:id gives `story.issue.diverged`: null, or { at: ISO date, githubTitle, githubBody, cockpitTitle, cockpitBody }.
// - The section is a <section> whose heading is « Issue modifiée sur GitHub ». It shows the date as `toLocaleString("fr-FR")`;
//   when the titles differ, a line « Titre » with GitHub's title; the diff of the bodies (Cockpit's version -> GitHub's) as list items:
//   a removed line holds the word « Retirée », an added one the word « Ajoutée », an unchanged one neither.
//   Over 2,000 lines on a side there is no diff: two headings « Version de Cockpit » and « Version de GitHub », each above its text.
// - Two buttons, « Garder la version de Cockpit » (POST /api/stories/:id/issue/keep-cockpit) and « Reprendre la version de GitHub »
//   (POST /api/stories/:id/issue/take-github), no body, answer 200 { story }. Both are disabled in an archived project.
// - A refusal shows a French role="alert": for not_template, the message of the decision, whole; « statut » for wrong_status, « archiv »
//   for project_archived.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Diverged = {
  at: string;
  githubTitle: string;
  githubBody: string;
  cockpitTitle: string;
  cockpitBody: string;
};
type Issue = {
  number: number;
  url: string;
  upToDate: boolean;
  diverged: Diverged | null;
};
type WithIssue = DecisionStory & { issue: Issue | null };

const URL_12 = "https://github.com/octocat/hello/issues/12";
const AT = "2026-10-30T09:15:00.000Z";
const SECTION = "Issue modifiée sur GitHub";
const NOT_TEMPLATE =
  "La version de GitHub ne suit plus le gabarit de Cockpit : garde la version de Cockpit, ou recopie les changements avec « Modifier ».";
const main = () => screen.getByRole("main");
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("relire les exports"));
const button = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const section = () => {
  const found = screen
    .getByRole("heading", { name: SECTION })
    .closest("section");
  expect(found, "the heading sits in a section").not.toBeNull();
  return found as HTMLElement;
};

const diverged = (over: Partial<Diverged> = {}): Diverged => ({
  at: AT,
  githubTitle: "relire les exports",
  githubBody: "ligne un\nligne 2 modifiée\nligne trois\nligne ajoutée",
  cockpitTitle: "relire les exports",
  cockpitBody: "ligne un\nligne deux\nligne trois",
  ...over,
});

function seed(
  value: Diverged | null,
  options: { archived?: boolean; status?: string } = {},
) {
  const shown = decisionStory(
    story(21, 7, "relire les exports", { status: options.status ?? "ready" }),
    null,
  ) as WithIssue;
  shown.issue = { number: 12, url: URL_12, upToDate: true, diverged: value };
  const api = stubDecisionApi({
    tickets: [ticket(7, "Idée découpée")],
    stories: [shown],
    archived: options.archived,
  });
  const inner = globalThis.fetch;
  const next: { answer?: Answer } = {};
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
      if (
        method === "POST" &&
        /^\/api\/stories\/21\/issue\/(keep-cockpit|take-github)$/.test(path)
      ) {
        api.calls.push({
          method,
          path,
          body: init?.body === undefined ? undefined : String(init.body),
        });
        const refused = next.answer;
        next.answer = undefined;
        if (refused)
          return Response.json(refused.body, { status: refused.status });
        shown.issue = { ...(shown.issue as Issue), diverged: null };
        return Response.json({ story: { ...shown } });
      }
      return inner(input, init);
    }),
  );
  return { ...api, next };
}

describe("criterion E: the section of a diverged issue", () => {
  it("given a story whose issue was edited on GitHub, when the page loads, then a section « Issue modifiée sur GitHub » shows the date and the two buttons", async () => {
    seed(diverged());

    renderAt("/us/21");

    await loaded();
    expect(section().textContent).toContain(
      new Date(AT).toLocaleString("fr-FR"),
    );
    expect(button("Garder la version de Cockpit")).toBeDefined();
    expect(button("Reprendre la version de GitHub")).toBeDefined();
  });

  it("given a story whose issue did not change on GitHub, when the page loads, then the section is not there", async () => {
    seed(null);

    renderAt("/us/21");

    await loaded();
    expect(screen.queryByRole("heading", { name: SECTION })).toBeNull();
    expect(main().textContent).not.toContain(SECTION);
    expect(
      screen.queryByRole("button", { name: "Garder la version de Cockpit" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reprendre la version de GitHub" }),
    ).toBeNull();
  });

  it("given a changed title, when the page loads, then GitHub's title is shown on a « Titre » line", async () => {
    seed(diverged({ githubTitle: "Un titre écrit sur GitHub" }));

    renderAt("/us/21");

    await loaded();
    expect(section().textContent).toContain("Titre");
    expect(section().textContent).toContain("Un titre écrit sur GitHub");
  });

  it("given the same title on both sides, when the page loads, then the section has no « Titre » line", async () => {
    seed(diverged());

    renderAt("/us/21");

    await loaded();
    expect(section().textContent).not.toContain("Titre");
  });

  it("given a body with a line changed and a line added, when the page loads, then the removed and added lines are marked by the words Retirée and Ajoutée, in order, and the unchanged lines by none", async () => {
    seed(diverged());

    renderAt("/us/21");

    await loaded();
    const items = within(section())
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(items).toHaveLength(5);
    const only = (text: string) => items.findIndex((i) => i.includes(text));
    expect(items[only("ligne deux")]).toMatch(/Retirée/);
    expect(items[only("ligne deux")]).not.toMatch(/Ajoutée/);
    expect(items[only("ligne 2 modifiée")]).toMatch(/Ajoutée/);
    expect(items[only("ligne 2 modifiée")]).not.toMatch(/Retirée/);
    expect(items[only("ligne ajoutée")]).toMatch(/Ajoutée/);
    for (const same of ["ligne un", "ligne trois"])
      expect(items[only(same)]).not.toMatch(/Retirée|Ajoutée/);
    expect(only("ligne un")).toBeLessThan(only("ligne deux"));
    expect(only("ligne deux")).toBeLessThan(only("ligne 2 modifiée"));
    expect(only("ligne 2 modifiée")).toBeLessThan(only("ligne trois"));
    expect(only("ligne trois")).toBeLessThan(only("ligne ajoutée"));
  });

  it("given bodies of more than 2,000 lines, when the page loads, then both versions are shown one under the other, with no diff marks", async () => {
    const many = Array.from({ length: 2_001 }, (_, i) => `ligne ${i}`);
    seed(
      diverged({
        cockpitBody: many.join("\n"),
        githubBody: [
          ...many.slice(0, 5),
          "ligne changée",
          ...many.slice(6),
        ].join("\n"),
      }),
    );

    renderAt("/us/21");

    await loaded();
    const there = section();
    const cockpit = within(there).getByRole("heading", {
      name: "Version de Cockpit",
    });
    const github = within(there).getByRole("heading", {
      name: "Version de GitHub",
    });
    expect(
      cockpit.compareDocumentPosition(github) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(there.textContent).toContain("ligne changée");
    expect(there.textContent).toContain("ligne 5");
    expect(there.textContent).not.toMatch(/Retirée|Ajoutée/);
  });
});

describe("criterion F and G: the two buttons", () => {
  it.each([
    ["Garder la version de Cockpit", "keep-cockpit"],
    ["Reprendre la version de GitHub", "take-github"],
  ])(
    "given a diverged issue, when « %s » is clicked, then it posts to /api/stories/21/issue/%s with no body and the section is gone",
    async (name, route) => {
      const api = seed(diverged());
      renderAt("/us/21");
      await loaded();

      fireEvent.click(button(name));

      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: SECTION })).toBeNull(),
      );
      expect(api.writes().map((c) => [c.method, c.path, c.body])).toEqual([
        ["POST", `/api/stories/21/issue/${route}`, undefined],
      ]);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("given GitHub's body no longer follows the template, when GitHub's version is taken, then the French message of the decision is shown and the section stays", async () => {
    const api = seed(diverged());
    api.next.answer = fail(409, "not_template");
    renderAt("/us/21");
    await loaded();

    fireEvent.click(button("Reprendre la version de GitHub"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(NOT_TEMPLATE);
    expect(screen.getByRole("heading", { name: SECTION })).toBeDefined();
    expect(button("Garder la version de Cockpit").disabled).toBe(false);
  });

  it.each([
    ["wrong_status", /statut/i],
    ["project_archived", /archiv/i],
  ])(
    "given the server refuses with %s, when GitHub's version is taken, then a French alert says why",
    async (code, words) => {
      const api = seed(diverged());
      api.next.answer = fail(409, code);
      renderAt("/us/21");
      await loaded();

      fireEvent.click(button("Reprendre la version de GitHub"));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(words);
    },
  );

  it("given an archived project, when the page loads, then both buttons are disabled", async () => {
    seed(diverged(), { archived: true });

    renderAt("/us/21");

    await loaded();
    expect(button("Garder la version de Cockpit").disabled).toBe(true);
    expect(button("Reprendre la version de GitHub").disabled).toBe(true);
  });

  it.each(["in_progress", "in_review", "done", "abandoned"])(
    "given a %s story, when the page loads, then « Garder la version de Cockpit » is offered (any status)",
    async (status) => {
      seed(diverged(), { status });

      renderAt("/us/21");

      await loaded();
      expect(button("Garder la version de Cockpit").disabled).toBe(false);
    },
  );
});
