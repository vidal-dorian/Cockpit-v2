// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  empty,
  FakeEventSource,
  type HomeData,
  PROJECT,
  stubHome,
} from "./test-home.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 8.1 (decision 040 B to H), restyled by slice 9.3 (decision 045): the home page of a logged-in user. Pinned:
// - what waits for the user is « 1 · Maintenant » (the first item) and « 2 · Ensuite » (the others), the item at the panel is in aside[data-panel];
// - the CI is in words: « La CI échoue » (failure), « La CI tourne encore » (pending), « La CI est verte » (success), « Aucune CI » (null);
// - the projects and their pastilles moved to the sidebar (Shell.test.tsx).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const section = (name: string) => {
  const heading = screen.getByRole("heading", { name: new RegExp(name) });
  const found = heading.closest("section");
  if (!found) throw new Error(`no <section> around « ${name} »`);
  return found;
};
const hrefs = (el: HTMLElement) =>
  within(el)
    .queryAllByRole("link")
    .map((a) => a.getAttribute("href"));
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent ?? "";

async function show(data: Partial<HomeData>, loggedIn = true) {
  const api = stubHome({ ...empty(), ...data }, loggedIn);
  renderAt("/");
  await screen.findByRole("heading", { level: 1 });
  return api;
}

const answer = {
  kind: "answer",
  questionId: 7,
  question: "Quel nom pour le bouton ?",
  suggestedAnswers: ["Valider", "Envoyer"],
  runId: 12,
  storyId: 21,
  iWant: "relire les exports",
  project: PROJECT,
  context: null,
  agent: "developer",
};
const validate = {
  kind: "validate",
  storyId: 22,
  iWant: "trier les exports",
  project: PROJECT,
};
const review = (prCiState: string | null) => ({
  kind: "review",
  storyId: 23,
  iWant: "exporter en CSV",
  prNumber: 14,
  prCiState,
  project: PROJECT,
});
const check = {
  kind: "check",
  storyId: 24,
  iWant: "filtrer par date",
  runId: 31,
  reasons: ["run_not_succeeded", "ci_failing", "no_pull_request"],
  project: PROJECT,
};

describe("criterion 5: the items of forYou", () => {
  it("given a question, when the home loads, then the panel shows the question, the project and the answer block", async () => {
    await show({ forYou: [answer] });

    expect(section("1 · Maintenant").textContent).toContain(
      "Quel nom pour le bouton ?",
    );
    expect(section("1 · Maintenant").textContent).toContain("hello");
    const p = within(panel());
    expect(p.getByRole("button", { name: "Valider" })).toBeDefined();
    expect(p.getByRole("button", { name: "Envoyer" })).toBeDefined();
    expect(p.getByLabelText("Ta réponse")).toBeDefined();
    expect(
      p.getByRole("button", { name: "Répondre et passer au suivant" }),
    ).toBeDefined();
  });

  it("given a question, when I click a suggested answer, then it is POSTed to /api/questions/7/answer and the home is read again", async () => {
    const api = await show({ forYou: [answer] });
    const before = api.homeReads();

    api.state.home = { ...empty() };
    fireEvent.click(within(panel()).getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/api/questions/7/answer",
        body: { answer: "Envoyer" },
      }),
    );
    await waitFor(() => expect(api.homeReads()).toBeGreaterThan(before));
    await waitFor(() => expect(h1()).toContain("Rien ne t'attend."));
  });

  it("given a question, when I type my answer and send it, then it is POSTed as typed", async () => {
    const api = await show({ forYou: [answer] });

    fireEvent.change(within(panel()).getByLabelText("Ta réponse"), {
      target: { value: "Plutôt Publier" },
    });
    fireEvent.click(
      within(panel()).getByRole("button", {
        name: "Répondre et passer au suivant",
      }),
    );

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/api/questions/7/answer",
        body: { answer: "Plutôt Publier" },
      }),
    );
  });

  it("given a story to validate, when the home loads, then it shows the story and the project and the panel links to /us/22", async () => {
    await show({ forYou: [validate] });

    const s = section("1 · Maintenant");
    expect(s.textContent).toContain("trier les exports");
    expect(s.textContent).toContain("hello");
    expect(hrefs(panel())).toContain("/us/22");
  });

  it("given a story to validate in « 2 · Ensuite », when Valider is clicked, then it posts the validation and reads the home again", async () => {
    const api = await show({ forYou: [answer, validate] });
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      (input: string | URL | Request, init?: RequestInit) =>
        String(input instanceof Request ? input.url : input).endsWith(
          "/api/stories/22/validate",
        )
          ? Promise.resolve(Response.json({ id: 22 }))
          : base(input, init),
    );

    fireEvent.click(
      within(section("2 · Ensuite")).getByRole("button", { name: "Valider" }),
    );

    await waitFor(() =>
      expect(
        api.calls.filter((c) => c.path === "/api/home").length,
      ).toBeGreaterThan(1),
    );
  });

  it.each([
    ["failure", "La CI échoue"],
    ["pending", "La CI tourne encore"],
    ["success", "La CI est verte"],
    [null, "Aucune CI"],
  ])(
    "given a PR to review with CI %s, when the home loads, then it says « %s » and the panel links to GitHub and /us/23",
    async (ci, words) => {
      await show({ forYou: [review(ci)] });

      const s = section("1 · Maintenant");
      expect(s.textContent).toContain(words);
      expect(s.textContent).toContain("exporter en CSV");
      expect(s.textContent).toContain("hello");
      expect(hrefs(panel())).toContain(
        "https://github.com/octocat/hello/pull/14",
      );
      expect(hrefs(panel())).toContain("/us/23");
    },
  );

  it("given a run to check, when the home loads, then the panel links to /runs/31 and gives the reasons in French", async () => {
    await show({ forYou: [check] });

    expect(section("1 · Maintenant").textContent).toContain("filtrer par date");
    expect(section("1 · Maintenant").textContent).toContain("hello");
    expect(hrefs(panel())).toContain("/runs/31");
    expect(panel().textContent).toContain("Le run n'a pas réussi");
    expect(panel().textContent).toContain("La CI échoue");
    expect(panel().textContent).toContain("Aucune PR liée");
  });

  it("given items of every kind, when the home loads, then they are listed in the order the server gave", async () => {
    await show({ forYou: [answer, validate, review("success"), check] });

    const text =
      section("1 · Maintenant").textContent +
      (section("2 · Ensuite").textContent ?? "");
    const at = [
      "Quel nom pour le bouton ?",
      "trier les exports",
      "exporter en CSV",
      "filtrer par date",
    ].map((t) => text.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("given a second item, when the home loads, then its row of 2 · Ensuite keeps the links of today: the PR on GitHub and the US", async () => {
    await show({ forYou: [validate, review("success")] });

    expect(hrefs(section("2 · Ensuite"))).toEqual([
      "https://github.com/octocat/hello/pull/14",
      "/us/23",
    ]);
  });

  it("given runs working, when the home loads, then each row links to /runs/:id with its step agent or « Démarrage »", async () => {
    await show({
      claudeWorks: [
        {
          runId: 12,
          storyId: 21,
          iWant: "relire les exports",
          project: PROJECT,
          step: "developer",
        },
        {
          runId: 13,
          storyId: 22,
          iWant: "trier les exports",
          project: PROJECT,
          step: null,
        },
      ],
    });

    const s = section("Claude en ce moment");
    expect(hrefs(s)).toEqual(["/runs/12", "/runs/13"]);
    const [first, second] = within(s).getAllByRole("link");
    expect(first?.textContent).toContain("hello");
    expect(first?.textContent).toContain("developer");
    expect(second?.textContent).toContain("Démarrage");
    expect(first?.textContent).not.toContain("Démarrage");
  });
});

describe("criterion 6: the empty states", () => {
  it("given nothing to do and Claude idle, when the home loads, then the sentence says so", async () => {
    await show({ projects: [{ id: 5, name: "octocat/hello", state: "idle" }] });

    expect(h1()).toContain("Rien ne t'attend.");
    expect(h1()).toContain("Claude ne travaille sur rien.");
  });

  it("given items and a run, when the home loads, then the empty messages are not shown", async () => {
    await show({
      forYou: [validate],
      claudeWorks: [
        { runId: 12, storyId: 21, iWant: "x", project: PROJECT, step: null },
      ],
    });

    expect(h1()).not.toContain("Rien ne t'attend.");
    expect(h1()).not.toContain("Claude ne travaille sur rien.");
  });
});

describe("criterion 8: the home follows the stream", () => {
  it("given the home is shown, when a change event arrives on /api/events, then it reads /api/home again whatever the object", async () => {
    const api = await show({});
    await waitFor(() => expect(FakeEventSource.all.length).toBeGreaterThan(0));
    const source = FakeEventSource.all.find((s) => s.url === "/api/events");
    expect(source).toBeDefined();
    const before = api.homeReads();

    api.state.home = { ...empty(), forYou: [validate] };
    source?.emit("change", "story:99");

    await waitFor(() => expect(h1()).toContain("1 chose t'attend."));
    expect(api.homeReads()).toBeGreaterThan(before);
  });
});

describe("criterion 9: logged out", () => {
  it("given a logged-out visitor, when the home loads, then it shows the current page and never reads /api/home", async () => {
    const api = stubHome(empty(), false);
    renderAt("/");

    expect(
      await screen.findByRole("link", { name: "Se connecter avec GitHub" }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: /Maintenant/ })).toBeNull();
    expect(api.homeReads()).toBe(0);
  });
});

const entry = (i: number, project: string | null, action = "login") => ({
  id: 100 - i,
  at: `2026-10-${20 - i}T12:00:00.000Z`,
  actor: "human",
  origin: "ui",
  action,
  result: "ok",
  project,
});

describe("what was done lately", () => {
  it("given more than 5 history entries, when the home loads, then Dernièrement lists the first 5 with action, project and date, and links to /journal", async () => {
    const api = stubHome(empty());
    api.state.history = {
      entries: [
        entry(0, "octocat/p0"),
        entry(1, "octocat/p1"),
        entry(2, "octocat/p2"),
        entry(3, "octocat/p3"),
        entry(4, null),
        entry(5, "octocat/sixth", "revoke_token"),
      ],
      hasMore: true,
    };
    renderAt("/");
    await screen.findByRole("heading", { name: "Dernièrement" });

    const s = section("Dernièrement");
    const items = within(s).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]?.textContent).toContain("Connexion");
    expect(items[0]?.textContent).toContain("octocat/p0");
    expect(items[0]?.textContent).toMatch(/2026/);
    expect(items[3]?.textContent).toContain("octocat/p3");
    expect(items[4]?.textContent).not.toContain("octocat/");
    expect(s.textContent).not.toContain("octocat/sixth");
    expect(s.textContent).not.toContain("Jeton révoqué");
    expect(
      within(s)
        .getByRole("link", { name: "Voir tout le journal" })
        .getAttribute("href"),
    ).toBe("/journal");
  });

  it("given no history entry, when the home loads, then Dernièrement says Rien de fait pour l'instant.", async () => {
    stubHome(empty());
    renderAt("/");
    await screen.findByRole("heading", { name: "Dernièrement" });

    expect(section("Dernièrement").textContent).toContain(
      "Rien de fait pour l'instant.",
    );
  });
});

describe("slice 9.3 review: the answer panel", () => {
  const second = { ...answer, questionId: 8, question: "Quel ordre ?" };

  it("given a question, when the panel opens, then it links its story and its run", async () => {
    await show({ forYou: [answer] });

    const p = within(panel());
    expect(panel().textContent).toContain("US 21 · étape developer · Run 12 ↗");
    expect(p.getByRole("link", { name: /US 21/ }).getAttribute("href")).toBe(
      "/us/21",
    );
    expect(p.getByRole("link", { name: /Run 12/ }).getAttribute("href")).toBe(
      "/runs/12",
    );
  });

  it("given a typed answer to the 2nd question, when a question arrives before it, then the typed text and the question stay", async () => {
    const api = await show({ forYou: [answer, second] });
    fireEvent.click(within(panel()).getByRole("button", { name: "Suivant" }));
    fireEvent.change(within(panel()).getByLabelText("Ta réponse"), {
      target: { value: "à moitié tapé" },
    });

    api.state.home = {
      ...empty(),
      forYou: [
        { ...answer, questionId: 9, question: "Nouvelle ?" },
        answer,
        second,
      ],
    };
    for (const s of FakeEventSource.all) s.emit("change", "story:99");

    await waitFor(() =>
      expect(h1()).toContain("Claude est bloqué sur 3 runs."),
    );
    expect(within(panel()).getByText("Quel ordre ?")).toBeDefined();
    expect(
      (within(panel()).getByLabelText("Ta réponse") as HTMLTextAreaElement)
        .value,
    ).toBe("à moitié tapé");
  });

  it("given a typed answer to the first question, when a question arrives before it without any click, then the typed text and the question stay", async () => {
    const api = await show({ forYou: [answer] });
    fireEvent.change(within(panel()).getByLabelText("Ta réponse"), {
      target: { value: "pas fini" },
    });

    api.state.home = {
      ...empty(),
      forYou: [{ ...answer, questionId: 9, question: "Nouvelle ?" }, answer],
    };
    for (const s of FakeEventSource.all) s.emit("change", "story:99");

    await waitFor(() =>
      expect(within(panel()).getByText("2 sur 2")).toBeDefined(),
    );
    expect(
      within(panel()).getByText("Quel nom pour le bouton ?"),
    ).toBeDefined();
    expect(
      (within(panel()).getByLabelText("Ta réponse") as HTMLTextAreaElement)
        .value,
    ).toBe("pas fini");
  });

  it("given the last question, when I answer it, then the focus is on the page title, not on the body", async () => {
    const api = await show({ forYou: [answer] });

    api.state.home = empty();
    fireEvent.click(within(panel()).getByRole("button", { name: "Envoyer" }));

    await waitFor(() => expect(h1()).toContain("Rien ne t'attend."));
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1 }),
    );
  });

  it("given a question in « 2 · Ensuite », when I click Répondre, then it opens in the panel and the focus is on its heading", async () => {
    await show({ forYou: [validate, answer] });

    fireEvent.click(
      within(section("2 · Ensuite")).getByRole("button", { name: "Répondre" }),
    );

    const heading = within(panel()).getByRole("heading", {
      name: "Quel nom pour le bouton ?",
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});

describe("slice 14.4 (decision 059 D): the relaunches are exhausted", () => {
  it("given a story whose CI still fails after 3 relaunches, when the home loads, then the message links to the story", async () => {
    await show({
      forYou: [
        {
          kind: "relaunch_exhausted",
          storyId: 25,
          iWant: "exporter en PDF",
          prNumber: 15,
          project: PROJECT,
        },
      ],
    });

    expect(section("1 · Maintenant").textContent).toContain(
      "Relances épuisées : la CI échoue encore après 3 essais",
    );
    expect(hrefs(section("1 · Maintenant"))).toContain("/us/25");
  });
});
