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
import { renderAt } from "./test-tickets.tsx";

// Slice 8.1 (decision 040 B to H): the home page of a logged-in user. Pinned (the decision leaves them open):
// - the sections are headings « À toi de jouer », « Claude travaille », « Projets » (each section is the <section> of its heading);
// - the CI is in words: « La CI échoue » (failure), « La CI tourne encore » (pending), « La CI est verte » (success), « Aucune CI » (null);
// - the link to import projects (no project at all) is a link named /import/i to /projets;
// - the pastilles are the words « À toi », « Claude travaille », « Rien en cours » in the row of the project.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const section = (name: string) => {
  const heading = screen.getByRole("heading", { name });
  const found = heading.closest("section");
  if (!found) throw new Error(`no <section> around « ${name} »`);
  return found;
};
const hrefs = (el: HTMLElement) =>
  within(el)
    .queryAllByRole("link")
    .map((a) => a.getAttribute("href"));

async function show(data: Partial<HomeData>, loggedIn = true) {
  const api = stubHome({ ...empty(), ...data }, loggedIn);
  renderAt("/");
  await screen.findByRole("heading", { name: "À toi de jouer" });
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

describe("criterion 5: the sections and the items of forYou", () => {
  it("given a logged-in user, when the home loads, then it has À toi de jouer, Claude travaille and Projets", async () => {
    await show({});

    for (const name of ["À toi de jouer", "Claude travaille", "Projets"])
      expect(screen.getByRole("heading", { name })).toBeDefined();
  });

  it("given a question, when the home loads, then it shows the question, the story, the project and the answer block", async () => {
    await show({ forYou: [answer] });

    const s = section("À toi de jouer");
    expect(s.textContent).toContain("Quel nom pour le bouton ?");
    expect(s.textContent).toContain("relire les exports");
    expect(s.textContent).toContain("octocat/hello");
    expect(within(s).getByRole("button", { name: "Valider" })).toBeDefined();
    expect(within(s).getByRole("button", { name: "Envoyer" })).toBeDefined();
    expect(within(s).getByLabelText("Ta réponse")).toBeDefined();
    expect(within(s).getByRole("button", { name: "Répondre" })).toBeDefined();
  });

  it("given a question, when I click a suggested answer, then it is POSTed to /api/questions/7/answer and the home is read again", async () => {
    const api = await show({ forYou: [answer] });
    const before = api.homeReads();

    api.state.home = { ...empty() };
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/api/questions/7/answer",
        body: { answer: "Envoyer" },
      }),
    );
    await waitFor(() => expect(api.homeReads()).toBeGreaterThan(before));
    expect(await screen.findByText("Rien ne t'attend.")).toBeDefined();
  });

  it("given a question, when I type my answer and send it, then it is POSTed as typed", async () => {
    const api = await show({ forYou: [answer] });

    fireEvent.change(screen.getByLabelText("Ta réponse"), {
      target: { value: "Plutôt Publier" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Répondre" }));

    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: "POST",
        path: "/api/questions/7/answer",
        body: { answer: "Plutôt Publier" },
      }),
    );
  });

  it("given a story to validate, when the home loads, then it shows the story and the project and links to /us/22", async () => {
    await show({ forYou: [validate] });

    const s = section("À toi de jouer");
    expect(s.textContent).toContain("trier les exports");
    expect(s.textContent).toContain("octocat/hello");
    expect(hrefs(s)).toContain("/us/22");
  });

  it.each([
    ["failure", "La CI échoue"],
    ["pending", "La CI tourne encore"],
    ["success", "La CI est verte"],
    [null, "Aucune CI"],
  ])(
    "given a PR to review with CI %s, when the home loads, then it says « %s » and links to GitHub and /us/23",
    async (ci, words) => {
      await show({ forYou: [review(ci)] });

      const s = section("À toi de jouer");
      expect(s.textContent).toContain(words);
      expect(s.textContent).toContain("exporter en CSV");
      expect(s.textContent).toContain("octocat/hello");
      expect(hrefs(s)).toContain("https://github.com/octocat/hello/pull/14");
      expect(hrefs(s)).toContain("/us/23");
    },
  );

  it("given a run to check, when the home loads, then it links to /runs/31 and gives the reasons in French", async () => {
    await show({ forYou: [check] });

    const s = section("À toi de jouer");
    expect(s.textContent).toContain("filtrer par date");
    expect(s.textContent).toContain("octocat/hello");
    expect(hrefs(s)).toContain("/runs/31");
    expect(s.textContent).toContain("Le run n'a pas réussi");
    expect(s.textContent).toContain("La CI échoue");
    expect(s.textContent).toContain("Aucune PR liée");
  });

  it("given items of every kind, when the home loads, then they are listed in the order the server gave", async () => {
    await show({ forYou: [answer, validate, review("success"), check] });

    const text = section("À toi de jouer").textContent ?? "";
    const at = [
      "relire les exports",
      "trier les exports",
      "exporter en CSV",
      "filtrer par date",
    ].map((t) => text.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
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

    const s = section("Claude travaille");
    expect(hrefs(s)).toEqual(["/runs/12", "/runs/13"]);
    const [first, second] = within(s).getAllByRole("link");
    expect(first?.textContent).toContain("relire les exports");
    expect(first?.textContent).toContain("octocat/hello");
    expect(first?.textContent).toContain("developer");
    expect(second?.textContent).toContain("Démarrage");
    expect(first?.textContent).not.toContain("Démarrage");
  });

  it.each([
    ["for_you", "À toi"],
    ["claude", "Claude travaille"],
    ["idle", "Rien en cours"],
  ])(
    "given a project in state %s, when the home loads, then its row shows « %s »",
    async (state, word) => {
      await show({ projects: [{ id: 5, name: "octocat/hello", state }] });

      const s = section("Projets");
      expect(s.textContent).toContain("octocat/hello");
      expect(s.textContent).toContain(word);
    },
  );
});

describe("criterion 6: the empty states", () => {
  it("given nothing to do and Claude idle, when the home loads, then both sections say so", async () => {
    await show({ projects: [{ id: 5, name: "octocat/hello", state: "idle" }] });

    expect(section("À toi de jouer").textContent).toContain(
      "Rien ne t'attend.",
    );
    expect(section("Claude travaille").textContent).toContain(
      "Claude ne travaille sur rien.",
    );
  });

  it("given items in both sections, when the home loads, then the empty messages are not shown", async () => {
    await show({
      forYou: [validate],
      claudeWorks: [
        { runId: 12, storyId: 21, iWant: "x", project: PROJECT, step: null },
      ],
    });

    expect(screen.queryByText("Rien ne t'attend.")).toBeNull();
    expect(screen.queryByText("Claude ne travaille sur rien.")).toBeNull();
  });

  it("given no project at all, when the home loads, then Projets links to the import of projects (/projets)", async () => {
    await show({});

    const link = within(section("Projets")).getByRole("link", {
      name: /import/i,
    });
    expect(link.getAttribute("href")).toBe("/projets");
  });

  it("given a project, when the home loads, then there is no import link", async () => {
    await show({ projects: [{ id: 5, name: "octocat/hello", state: "idle" }] });

    expect(
      within(section("Projets")).queryByRole("link", { name: /import/i }),
    ).toBeNull();
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

    await waitFor(() =>
      expect(section("À toi de jouer").textContent).toContain(
        "trier les exports",
      ),
    );
    expect(api.homeReads()).toBeGreaterThan(before);
  });
});

describe("criterion 9: logged out", () => {
  it("given a logged-out visitor, when the home loads, then it shows the current page and never reads /api/home", async () => {
    const api = stubHome(empty(), false);
    renderAt("/");

    expect(await screen.findByText("Serveur OK · v0.1.0")).toBeDefined();
    expect(
      await screen.findByRole("link", { name: "Se connecter avec GitHub" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "À toi de jouer" }),
    ).toBeNull();
    expect(api.homeReads()).toBe(0);
  });
});
