// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT } from "./test-home.tsx";
import { panel, stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 9.3 (decision 045 D): the home in four times. Pinned: « 1 · Maintenant », « 2 · Ensuite » and « Claude en ce moment »
// are <h2> of their <section>; the right panel is the aside[data-panel] and its counter reads « {i} sur {n} ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const answer = (questionId = 7, runId = 12) => ({
  kind: "answer",
  questionId,
  question: "Quel nom pour le bouton ?",
  suggestedAnswers: ["Valider", "Envoyer"],
  runId,
  storyId: 21,
  iWant: "relire les exports",
  project: PROJECT,
});
const validate = {
  kind: "validate",
  storyId: 22,
  iWant: "trier les exports",
  project: PROJECT,
};
const review = {
  kind: "review",
  storyId: 23,
  iWant: "exporter en CSV",
  prNumber: 14,
  prCiState: "success",
  project: PROJECT,
};
const work = (runId: number, step: string | null) => ({
  runId,
  storyId: 30 + runId,
  iWant: "x",
  project: PROJECT,
  step,
});

const h1 = async () =>
  (await screen.findByRole("heading", { level: 1 })).textContent ?? "";
const section = async (name: RegExp) => {
  const heading = await screen.findByRole("heading", { name });
  const found = heading.closest("section");
  if (!found) throw new Error(`no <section> around ${name}`);
  return found;
};

describe("slice 9.3: the state sentence of the home", () => {
  it.each([
    [[answer()], "Claude est bloqué sur 1 run."],
    [[answer(7, 12), answer(8, 13)], "Claude est bloqué sur 2 runs."],
  ])(
    "given %# answer items, when the home loads, then the sentence says Claude est bloqué and Le reste peut attendre.",
    async (forYou, title) => {
      stubShell({ forYou });
      renderAt("/");

      await waitFor(async () => expect(await h1()).toContain(title));
      expect(await h1()).toContain("Le reste peut attendre.");
    },
  );

  it("given one item that is not a question and no run, when the home loads, then it says 1 chose t'attend. and Claude ne travaille sur rien.", async () => {
    stubShell({ forYou: [validate] });
    renderAt("/");

    await waitFor(async () =>
      expect(await h1()).toContain("1 chose t'attend."),
    );
    expect(await h1()).toContain("Claude ne travaille sur rien.");
  });

  it("given three items that are not questions and a run, when the home loads, then it says 3 choses t'attendent. and Claude travaille sur 1 run, tout va bien.", async () => {
    stubShell({
      forYou: [validate, review, { ...validate, storyId: 25 }],
      claudeWorks: [work(12, null)],
    });
    renderAt("/");

    await waitFor(async () =>
      expect(await h1()).toContain("3 choses t'attendent."),
    );
    expect(await h1()).toContain("Claude travaille sur 1 run, tout va bien.");
  });

  it("given nothing for the user and two runs, when the home loads, then it says Rien ne t'attend. and Claude travaille sur 2 runs, tout va bien.", async () => {
    stubShell({ claudeWorks: [work(12, null), work(13, "developer")] });
    renderAt("/");

    await waitFor(async () =>
      expect(await h1()).toContain("Rien ne t'attend."),
    );
    expect(await h1()).toContain("Claude travaille sur 2 runs, tout va bien.");
  });

  it("given nothing at all, when the home loads, then it says Rien ne t'attend. and Claude ne travaille sur rien.", async () => {
    stubShell({});
    renderAt("/");

    await waitFor(async () =>
      expect(await h1()).toContain("Rien ne t'attend."),
    );
    expect(await h1()).toContain("Claude ne travaille sur rien.");
  });
});

describe("slice 9.3: Maintenant, Ensuite and Claude en ce moment", () => {
  it("given two items, when the home loads, then 1 · Maintenant shows the first and 2 · Ensuite lists the other", async () => {
    stubShell({ forYou: [validate, review] });
    renderAt("/");

    const now = await section(/1 · Maintenant/);
    expect(now.textContent).toContain("trier les exports");
    expect(now.textContent).not.toContain("exporter en CSV");
    const next = await section(/2 · Ensuite/);
    expect(next.textContent).toContain("exporter en CSV");
    expect(next.textContent).not.toContain("trier les exports");
  });

  it("given a single item, when the home loads, then there is no 2 · Ensuite", async () => {
    stubShell({ forYou: [validate] });
    renderAt("/");

    await section(/1 · Maintenant/);
    expect(screen.queryByRole("heading", { name: /2 · Ensuite/ })).toBeNull();
  });

  it("given two runs, when the home loads, then Claude en ce moment links Run {id} · {project} to /runs/:id with the step or Démarrage", async () => {
    stubShell({ claudeWorks: [work(12, "developer"), work(13, null)] });
    renderAt("/");

    const s = await section(/Claude en ce moment/);
    const links = within(s).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/runs/12",
      "/runs/13",
    ]);
    expect(links[0]?.textContent).toContain("Run 12 · octocat/hello");
    expect(links[0]?.textContent).toContain("developer");
    expect(links[1]?.textContent).toContain("Démarrage");
  });

  it("given no run, when the home loads, then there is no Claude en ce moment", async () => {
    stubShell({ forYou: [validate] });
    renderAt("/");

    await section(/1 · Maintenant/);
    expect(
      screen.queryByRole("heading", { name: /Claude en ce moment/ }),
    ).toBeNull();
  });

  it("given projects with pastilles before, when the home loads, then it no longer lists the projects with À toi, Claude travaille or Rien en cours", async () => {
    stubShell({
      projects: [
        { id: 5, name: "octocat/hello", state: "idle" },
        { id: 8, name: "octocat/world", state: "for_you" },
      ],
      forYou: [validate],
    });
    renderAt("/");

    await section(/1 · Maintenant/);
    expect(screen.queryByText("Rien en cours")).toBeNull();
    expect(screen.queryByText("À toi")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Projets" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "À toi de jouer" }),
    ).toBeNull();
  });
});

describe("slice 9.3: the right panel of the home", () => {
  it("given three items, when the home loads, then the panel shows the first as 1 sur 3 and Suivant moves to the second as 2 sur 3", async () => {
    stubShell({
      forYou: [
        validate,
        review,
        { ...validate, storyId: 25, iWant: "dernier" },
      ],
    });
    renderAt("/");

    await screen.findByRole("heading", { name: /1 · Maintenant/ });
    await waitFor(() => expect(panel().textContent).toContain("1 sur 3"));
    expect(panel().textContent).toContain("trier les exports");

    fireEvent.click(within(panel()).getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(panel().textContent).toContain("2 sur 3"));
    expect(panel().textContent).toContain("exporter en CSV");
    expect(panel().textContent).not.toContain("trier les exports");
  });

  it("given a question, when I click a suggested answer in the panel, then it POSTs the same answer as before", async () => {
    const api = stubShell({ forYou: [answer()] });
    renderAt("/");

    await screen.findByRole("heading", { name: /1 · Maintenant/ });
    await waitFor(() =>
      expect(panel().textContent).toContain("Quel nom pour le bouton ?"),
    );
    fireEvent.click(within(panel()).getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/api/questions/7/answer",
        body: { answer: "Envoyer" },
      }),
    );
  });

  it("given a question, when I type my answer in the panel and send it, then it POSTs it as typed", async () => {
    const api = stubShell({ forYou: [answer()] });
    renderAt("/");

    await waitFor(() =>
      expect(panel().textContent).toContain("Quel nom pour le bouton ?"),
    );
    fireEvent.change(within(panel()).getByLabelText("Ta réponse"), {
      target: { value: "Plutôt Publier" },
    });
    fireEvent.click(within(panel()).getByRole("button", { name: "Répondre" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/api/questions/7/answer",
        body: { answer: "Plutôt Publier" },
      }),
    );
  });
});
