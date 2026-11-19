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
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { PROJECT } from "./test-home.tsx";
import { panel } from "./test-shell.tsx";
import { fail, renderAt, story, ticket } from "./test-tickets.tsx";

// Decision 084 A, B, C, D, E, I (slice S03): the home shows the story to validate in the right panel with its decisions, then the next one;
// every line title and the « Maintenant » card open the panel; a refused « Valider » says why and leads to the fix; the section links of the mockups.
// Pinned: GET /api/home as in test-home.tsx (the validate item may carry criteriaCount); GET /api/stories/:id and POST /api/stories/:id/validate
// as in test-decisions.tsx; GET /api/nights/current gives { night, ready, toValidate }; GET /api/projects may give a `role` per project.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Seed = Record<string, unknown>;
const toValidate = (id: number) => ({
  kind: "validate",
  storyId: id,
  iWant: `vouloir-${id}`,
  criteriaCount: 1,
  project: PROJECT,
});
const answerItem = (id: number) => ({
  kind: "answer",
  questionId: id,
  question: `Question ${id} ?`,
  suggestedAnswers: ["Oui", "Non"],
  runId: 10 + id,
  storyId: 40 + id,
  iWant: `relire ${id}`,
  project: PROJECT,
});
const relaunch = (id: number, prNumber: number) => ({
  kind: "relaunch_exhausted",
  storyId: id,
  iWant: `exporter-${id}`,
  prNumber,
  project: PROJECT,
});
const stories = (ids: number[]) =>
  ids.map((id) =>
    decisionStory(
      story(id, 7, `vouloir-${id}`, {
        asA: `rôle-${id}`,
        criteria: [
          {
            id: id * 10,
            position: 1,
            given: `état-${id}`,
            when: `action-${id}`,
            then: `résultat-${id}`,
          },
        ],
      }),
    ),
  );

type Options = {
  forYou: Seed[];
  stories?: number[];
  claudeWorks?: Seed[];
  night?: Seed;
  ready?: Seed[];
  role?: string;
  noProjects?: boolean;
  /** Seed of the home that the test may change while it runs. */
  fail?: { home?: boolean; history?: boolean };
};

/** The decision fake (stories, validate) plus a home that follows the validations. */
function load(o: Options) {
  const api = stubDecisionApi({
    tickets: [ticket(7, "Idée A")],
    stories: stories(o.stories ?? []),
  });
  const home = {
    forYou: [...o.forYou],
    claudeWorks: o.claudeWorks ?? [],
    projects: o.noProjects ? [] : [{ ...PROJECT, state: "for_you" }],
    ...(o.night ? { night: o.night } : {}),
  };
  const fails = o.fail ?? {};
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
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/home")
        return fails.home
          ? Response.json({ error: "x" }, { status: 500 })
          : Response.json(home);
      if (path === "/api/history")
        return fails.history
          ? Response.json({ error: "x" }, { status: 500 })
          : Response.json({ entries: [], hasMore: false });
      if (path === "/api/installation")
        return Response.json({ installed: true, installUrl: "https://x" });
      if (path === "/api/nights/current")
        return Response.json({
          night: null,
          ready: o.ready ?? [],
          toValidate: [],
        });
      if (path === "/api/projects" && method === "GET" && o.role)
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: false,
              role: o.role,
            },
          ],
        });
      if (/^\/api\/questions\/\d+\/answer$/.test(path))
        return Response.json({ ok: true });
      const res = await inner(input, init);
      const done = /^\/api\/stories\/(\d+)\/validate$/.exec(path);
      if (done && res.ok)
        home.forYou = home.forYou.filter(
          (i) => !(i.kind === "validate" && i.storyId === Number(done[1])),
        );
      return res;
    }),
  );
  return { api, home, fails };
}

const section = (name: string) => {
  const found = screen
    .getByRole("heading", { name: new RegExp(name) })
    .closest("section");
  if (!found) throw new Error(`no <section> around « ${name} »`);
  return found;
};
const inPanel = () => within(panel());
/** Waits for the text to show in the panel (the panel itself exists from the first render). */
const seen = (text: RegExp | string) =>
  waitFor(() => inPanel().getByText(text));
const posts = (api: ReturnType<typeof load>["api"]) =>
  api.calls.filter((c) => c.method === "POST").map((c) => c.path);

describe("decision 084 A, I: a story to validate opens in the panel with its evidence and decisions", () => {
  it("given a story to validate first of the list, when the home loads, then the panel shows the narrative, the Given/When/Then criteria and the decisions, with the counter", async () => {
    load({ forYou: [toValidate(22), toValidate(23)], stories: [22, 23] });
    renderAt("/");

    const p = within(await waitFor(() => panel()));
    await p.findByText(/rôle-22/);
    expect(p.getByText(/gagner du temps/)).toBeDefined();
    expect(p.getByText(/état-22/)).toBeDefined();
    expect(p.getByText(/action-22/)).toBeDefined();
    expect(p.getByText(/résultat-22/)).toBeDefined();
    for (const name of [
      "Valider",
      "Modifier",
      "Renvoyer à Claude",
      "Abandonner",
    ])
      expect(p.getByRole("button", { name })).toBeDefined();
    expect(p.getByText("1 sur 2")).toBeDefined();
  });

  it("given a story to validate in the panel, when the home loads, then the link to the page of the story stays", async () => {
    load({ forYou: [toValidate(22)], stories: [22] });
    renderAt("/");

    const p = within(await waitFor(() => panel()));
    await p.findByText(/état-22/);
    expect(
      p.getByRole("link", { name: /Ouvrir l'US/ }).getAttribute("href"),
    ).toBe("/us/22");
  });

  it("given two stories to validate, when Valider is clicked in the panel, then the validation is posted and the panel shows the next story without leaving the home", async () => {
    const { api } = load({
      forYou: [toValidate(22), toValidate(23)],
      stories: [22, 23],
    });
    renderAt("/");
    const p = within(await waitFor(() => panel()));
    await p.findByText(/état-22/);

    fireEvent.click(p.getByRole("button", { name: "Valider" }));

    await waitFor(() =>
      expect(posts(api)).toContain("/api/stories/22/validate"),
    );
    await seen(/état-23/);
    expect(within(panel()).queryByText(/état-22/)).toBeNull();
    expect(window.location.pathname).toBe("/");
  });

  it("given two stories to validate, when Valider is clicked in the panel, then the focus stays in the panel", async () => {
    load({ forYou: [toValidate(22), toValidate(23)], stories: [22, 23] });
    renderAt("/");
    const p = within(await waitFor(() => panel()));
    await p.findByText(/état-22/);

    fireEvent.click(p.getByRole("button", { name: "Valider" }));

    await seen(/état-23/);
    await waitFor(() =>
      expect(panel().contains(document.activeElement)).toBe(true),
    );
  });

  it("given a story to validate in the panel, when V is pressed, then it is validated there", async () => {
    const { api } = load({
      forYou: [toValidate(22), toValidate(23)],
      stories: [22, 23],
    });
    renderAt("/");
    await waitFor(() => panel());

    fireEvent.keyDown(document.body, { key: "v" });

    await waitFor(() =>
      expect(posts(api)).toContain("/api/stories/22/validate"),
    );
  });
});

describe("decision 084 I, E: every line title and the Maintenant card open the panel", () => {
  it("given three stories to validate, when the title of the third row is clicked, then the panel shows it, and the Maintenant card brings back the first", async () => {
    load({
      forYou: [toValidate(22), toValidate(23), toValidate(24)],
      stories: [22, 23, 24],
    });
    renderAt("/");
    await waitFor(() => panel());

    fireEvent.click(
      within(section("2 · Ensuite")).getByRole("button", {
        name: /vouloir-24/,
      }),
    );
    await seen(/état-24/);
    expect(inPanel().getByText("3 sur 3")).toBeDefined();

    fireEvent.click(
      within(section("1 · Maintenant")).getByRole("button", {
        name: /vouloir-22/,
      }),
    );
    await seen(/état-22/);
    expect(inPanel().getByText("1 sur 3")).toBeDefined();
  });

  it("given a relaunch exhausted in the rows, when its title is clicked, then the panel shows it", async () => {
    load({ forYou: [toValidate(22), relaunch(25, 15)], stories: [22] });
    renderAt("/");
    await waitFor(() => panel());

    fireEvent.click(
      within(section("2 · Ensuite")).getByRole("button", {
        name: /exporter-25/,
      }),
    );

    await waitFor(() => expect(inPanel().getByText("2 sur 2")).toBeDefined());
  });
});

describe("decision 084 D: a refused Valider of a row says why and leads to the fix", () => {
  it("given a story whose rules are still to decide, when Valider of its row is clicked, then the alert says so and links the rules screen", async () => {
    const { api } = load({
      forYou: [toValidate(22), toValidate(23)],
      stories: [22, 23],
    });
    api.failNext.validate = fail(409, "rules_pending");
    renderAt("/");
    await waitFor(() => panel());

    fireEvent.click(
      within(section("2 · Ensuite")).getByRole("button", { name: "Valider" }),
    );

    const alert = await within(section("2 · Ensuite")).findByRole("alert");
    expect(alert.textContent).toContain("Des règles sont encore à trancher.");
    expect(
      within(alert)
        .getByRole("link", { name: /Trancher dans l'écran de reprise/ })
        .getAttribute("href"),
    ).toBe("/projets/5/conception/regles");
  });

  it("given a role refused by the server, when Valider of a row is clicked, then the alert gives the sentence of the role", async () => {
    const { api } = load({
      forYou: [toValidate(22), toValidate(23)],
      stories: [22, 23],
    });
    api.failNext.validate = fail(403, "role");
    renderAt("/");
    await waitFor(() => panel());

    fireEvent.click(
      within(section("2 · Ensuite")).getByRole("button", { name: "Valider" }),
    );

    expect(
      (await within(section("2 · Ensuite")).findByRole("alert")).textContent,
    ).toContain("Ton rôle sur ce projet ne le permet pas.");
  });

  it("given a read-only role on the project, when the home loads, then the rows have no Valider", async () => {
    load({
      forYou: [toValidate(22), toValidate(23)],
      stories: [22, 23],
      role: "read_only",
    });
    renderAt("/");
    await screen.findByRole("heading", { name: /2 · Ensuite/ });

    await waitFor(() =>
      expect(
        within(section("2 · Ensuite")).queryByRole("button", {
          name: "Valider",
        }),
      ).toBeNull(),
    );
  });
});

describe("decision 084 C: the exhausted relaunch links its PR", () => {
  it("given a relaunch exhausted first of the list, when the home loads, then the panel links PR #15 on GitHub and still the story", async () => {
    load({ forYou: [relaunch(25, 15)] });
    renderAt("/");

    const p = within(await waitFor(() => panel()));
    expect(p.getByRole("link", { name: /PR #15/ }).getAttribute("href")).toBe(
      "https://github.com/octocat/hello/pull/15",
    );
    expect(
      p.getByRole("link", { name: /Ouvrir l'US/ }).getAttribute("href"),
    ).toBe("/us/25");
  });

  it("given a relaunch exhausted in the rows, when the home loads, then its row links the PR on GitHub", async () => {
    load({ forYou: [toValidate(22), relaunch(26, 16)], stories: [22] });
    renderAt("/");
    await waitFor(() => panel());

    expect(
      within(section("2 · Ensuite"))
        .getByRole("link", { name: /PR #16/ })
        .getAttribute("href"),
    ).toBe("https://github.com/octocat/hello/pull/16");
  });
});

describe("decision 084 E: the section links of the mockups", () => {
  it("given a run working, when the home loads, then « Claude en ce moment » links « Tous les runs » to /claude", async () => {
    load({
      forYou: [],
      claudeWorks: [
        {
          runId: 12,
          storyId: 3,
          iWant: "x",
          project: PROJECT,
          step: "developer",
        },
      ],
    });
    renderAt("/");

    const s = (await screen.findByText("Claude en ce moment")).closest(
      "section",
    );
    expect(
      within(s as HTMLElement)
        .getByRole("link", { name: /Tous les runs/ })
        .getAttribute("href"),
    ).toBe("/claude");
  });

  it("given nothing waiting and two stories ready for the night, when the home loads, then it offers « Préparer la nuit » to /nuit with the count", async () => {
    load({
      forYou: [],
      ready: [
        { storyId: 1, iWant: "a", project: PROJECT, estimatedSeconds: null },
        { storyId: 2, iWant: "b", project: PROJECT, estimatedSeconds: null },
      ],
    });
    renderAt("/");

    const link = await screen.findByRole("link", { name: /Préparer la nuit/ });
    expect(link.getAttribute("href")).toBe("/nuit");
    expect(link.closest("section,div")?.textContent).toMatch(/2 user stories/);
  });

  it("given something waiting, when the home loads, then there is no « Préparer la nuit »", async () => {
    load({
      forYou: [toValidate(22)],
      stories: [22],
      ready: [
        { storyId: 1, iWant: "a", project: PROJECT, estimatedSeconds: null },
      ],
    });
    renderAt("/");
    await seen(/état-22/);

    expect(screen.queryByRole("link", { name: /Préparer la nuit/ })).toBeNull();
  });
});

describe("decision 084 D: the error and empty states of the home lead out", () => {
  it("given the home cannot be read, when Réessayer is clicked, then it is read again", async () => {
    const { fails } = load({ forYou: [], fail: { home: true } });
    renderAt("/");
    const alert = (
      await screen.findByText("Impossible de lire l'accueil.")
    ).closest("[role=alert]") as HTMLElement;

    fails.home = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));

    await screen.findByRole("heading", { level: 1 });
  });

  it("given the journal cannot be read, when Réessayer is clicked, then it is read again", async () => {
    const { fails } = load({ forYou: [], fail: { history: true } });
    renderAt("/");
    const text = await screen.findByText("Impossible de lire le journal.");

    fails.history = false;
    fireEvent.click(
      within(text.parentElement as HTMLElement).getByRole("button", {
        name: "Réessayer",
      }),
    );

    await screen.findByText("Rien de fait pour l'instant.");
  });

  it("given no project and no guide, when the home loads, then it links « Importer un repo » to /projets", async () => {
    load({ forYou: [], noProjects: true });
    renderAt("/");
    await screen.findByText(/Rien ne t'attend/);

    const main = document.querySelector("main") as HTMLElement;
    expect(
      within(main)
        .getByRole("link", { name: "Importer un repo" })
        .getAttribute("href"),
    ).toBe("/projets");
  });
});

describe("decision 084 E: « Plus tard » of a question is a button", () => {
  it("given two questions, when « Plus tard » is clicked, then the panel shows the second, and on the last one the button is disabled", async () => {
    load({ forYou: [answerItem(1), answerItem(2)] });
    renderAt("/");
    const p = within(await waitFor(() => panel()));

    fireEvent.click(await p.findByRole("button", { name: /Plus tard/ }));

    await seen("2 sur 2");
    expect(within(panel()).getAllByText("Question 2 ?").length).toBeGreaterThan(
      0,
    );
    expect(
      (
        within(panel()).getByRole("button", {
          name: /Plus tard/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("decision 084 C, E: the morning block of the night links what it names", () => {
  const night = {
    id: 1,
    startsAt: new Date(2026, 10, 8, 22).toISOString(),
    endsAt: new Date(2026, 10, 9, 7).toISOString(),
    delivered: 1,
    total: 2,
    workSeconds: 600,
    criteriaProven: 1,
    failures: 1,
    items: [
      {
        storyId: 7,
        iWant: "faire la chose 7",
        outcome: "delivered",
        startedAt: new Date(2026, 10, 8, 23).toISOString(),
        finishedAt: new Date(2026, 10, 8, 23, 30).toISOString(),
      },
      {
        storyId: 8,
        iWant: "faire la chose 8",
        outcome: "failed",
        startedAt: new Date(2026, 10, 9, 1).toISOString(),
        finishedAt: new Date(2026, 10, 9, 1, 30).toISOString(),
      },
    ],
  };
  const block = async () =>
    within(
      (await screen.findByRole("heading", { name: /Cette nuit/ })).closest(
        "section",
      ) as HTMLElement,
    );

  it("given a night with two stories, when the home loads, then each line of the timeline links its story and « Voir la nuit » links /nuit", async () => {
    load({ forYou: [], night });
    renderAt("/");

    const b = await block();
    expect(
      b.getByRole("link", { name: /faire la chose 8/ }).getAttribute("href"),
    ).toBe("/us/8");
    expect(
      b.getByRole("link", { name: /faire la chose 7/ }).getAttribute("href"),
    ).toBe("/us/7");
    expect(
      b.getByRole("link", { name: /Voir la nuit/ }).getAttribute("href"),
    ).toBe("/nuit");
  });

  it("given a question waiting after the night, when « 1 question t'attend » is clicked, then the focus goes into the panel", async () => {
    load({ forYou: [answerItem(1)], night });
    renderAt("/");

    fireEvent.click(
      (await block()).getByRole("button", { name: /1 question t'attend/ }),
    );

    expect(panel().contains(document.activeElement)).toBe(true);
  });
});
