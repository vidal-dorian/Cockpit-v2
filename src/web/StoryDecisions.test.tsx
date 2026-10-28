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
  type HistoryEntry,
  stubDecisionApi,
} from "./test-decisions.tsx";
import { fail, renderAt, story, ticket } from "./test-tickets.tsx";

// Slice 4.4 (decision 018 J, I): the decisions on the page /us/:id. The labels pinned here (the decision names only
// the four buttons) are the ones the form uses:
// - « Renvoyer » opens a form: a field « Commentaire », « Confirmer le renvoi » (disabled while the comment is blank)
//   and « Annuler ».
// - « Abandonner » is replaced on the spot by « Confirmer l'abandon » and « Annuler ».
// - « Modifier » opens a form: fields « En tant que », « Je veux », « Afin de », « Notes », and per criterion « Étant
//   donné », « Quand » and « Alors », a « Retirer le critère N » button (N from 1), « Ajouter un critère »,
//   « Enregistrer » and « Annuler ». The body sent is { asA, iWant, soThat, notesMd, criteria: [{ given, when, then }] }.
// - A refused call shows a French role="alert": « statut » for wrong_status, « archiv » for project_archived.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
const button = (name: string | RegExp) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;
const maybeButton = (name: string | RegExp) =>
  screen.queryByRole("button", { name });
const click = (name: string | RegExp) => fireEvent.click(button(name));
const type = (label: string | RegExp, value: string, index = 0) =>
  fireEvent.change(screen.getAllByLabelText(label)[index] as HTMLElement, {
    target: { value },
  });
const loaded = () =>
  waitFor(() => expect(main().textContent).toContain("relire les exports"));

const ALL = [
  "to_validate",
  "to_rewrite",
  "ready",
  "in_progress",
  "in_review",
  "done",
  "abandoned",
] as const;
const LABEL: Record<string, string> = {
  to_validate: "à valider",
  to_rewrite: "à réécrire",
  ready: "prête",
  in_progress: "en cours",
  in_review: "en revue",
  done: "terminée",
  abandoned: "abandonnée",
};

function seed(
  status: string,
  over: Partial<DecisionStory> = {},
  options: { archived?: boolean; history?: HistoryEntry[] } = {},
) {
  const shown = decisionStory(
    story(21, 7, "relire les exports", {
      status,
      asA: "lectrice attentive",
      soThat: "corriger les erreurs",
      notesMd: "des notes",
      criteria: [
        {
          id: 210,
          position: 1,
          given: "donné-alpha",
          when: "quand-alpha",
          then: "alors-alpha",
        },
        {
          id: 211,
          position: 2,
          given: "donné-beta",
          when: "quand-beta",
          then: "alors-beta",
        },
      ],
    }),
    status === "to_rewrite" ? "Précise le cas vide" : null,
  );
  Object.assign(shown, over);
  return stubDecisionApi({
    tickets: [ticket(7, "Idée découpée")],
    stories: [shown],
    ...options,
  });
}

describe("criterion 11: the buttons depend on the status", () => {
  const BUTTONS: Record<string, string[]> = {
    Valider: ["to_validate", "to_rewrite"],
    Modifier: ["to_validate", "to_rewrite", "ready"],
    Renvoyer: ["to_validate"],
    Abandonner: ALL.filter((s) => s !== "abandoned"),
  };

  it.each(ALL)(
    "given a %s story, when the page loads, then Valider, Modifier, Renvoyer and Abandonner are shown exactly when the status allows them",
    async (status) => {
      seed(status);

      renderAt("/us/21");

      await loaded();
      for (const [name, statuses] of Object.entries(BUTTONS))
        expect(maybeButton(name) !== null, `${name} on a ${status} story`).toBe(
          statuses.includes(status),
        );
      expect(main().textContent).not.toContain(status);
    },
  );

  it("given a loaded story, when the page shows it, then it was read and nothing was written", async () => {
    const api = seed("to_validate");

    renderAt("/us/21");

    await loaded();
    expect(api.writes()).toEqual([]);
  });
});

describe("criterion 11: Valider", () => {
  it.each(["to_validate", "to_rewrite"])(
    "given a %s story, when Valider is clicked, then it posts to /validate and the page says prête, with no Valider, Renvoyer or comment left",
    async (status) => {
      const api = seed(status);
      renderAt("/us/21");
      await loaded();

      click("Valider");

      await waitFor(() => expect(main().textContent).toContain("prête"));
      expect(api.writes().map((c) => [c.method, c.path])).toEqual([
        ["POST", "/api/stories/21/validate"],
      ]);
      expect(main().textContent).not.toContain(LABEL[status] as string);
      expect(maybeButton("Valider")).toBeNull();
      expect(maybeButton("Renvoyer")).toBeNull();
      expect(main().textContent).not.toContain("Précise le cas vide");
      expect(main().textContent).not.toContain("wrong_status");
    },
  );

  it("given the story is no longer to validate on the server, when Valider is clicked and the server answers 409 wrong_status, then a French alert about the status is shown, never the code, and the page does not claim the story is prête", async () => {
    const api = seed("to_validate");
    renderAt("/us/21");
    await loaded();
    api.failNext.validate = fail(409, "wrong_status");

    click("Valider");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/statut/i);
    expect(alert.textContent).not.toContain("wrong_status");
    expect(main().textContent).not.toContain("prête");
  });

  it("given the project got archived, when Valider is clicked and the server answers 409 project_archived, then a French alert says the project is archived, never the code", async () => {
    const api = seed("to_validate");
    renderAt("/us/21");
    await loaded();
    api.failNext.validate = fail(409, "project_archived");

    click("Valider");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/archiv/i);
    expect(alert.textContent).not.toContain("project_archived");
  });
});

describe("criterion 11: Renvoyer", () => {
  it("given a to_validate story, when Renvoyer is clicked, then a Commentaire field and Confirmer le renvoi appear and nothing is sent yet", async () => {
    const api = seed("to_validate");
    renderAt("/us/21");
    await loaded();

    click("Renvoyer");

    expect(screen.getByLabelText(/Commentaire/)).toBeDefined();
    expect(button("Confirmer le renvoi")).toBeDefined();
    expect(button("Annuler")).toBeDefined();
    expect(api.writes()).toEqual([]);
  });

  it("given the form is open, when the comment is empty or only spaces, then Confirmer le renvoi is disabled and nothing can be sent; with a comment it is enabled", async () => {
    const api = seed("to_validate");
    renderAt("/us/21");
    await loaded();
    click("Renvoyer");

    expect(button("Confirmer le renvoi").disabled).toBe(true);
    type(/Commentaire/, "   ");
    expect(button("Confirmer le renvoi").disabled).toBe(true);
    fireEvent.click(button("Confirmer le renvoi"));
    expect(api.writes()).toEqual([]);
    type(/Commentaire/, "Précise le cas vide");
    expect(button("Confirmer le renvoi").disabled).toBe(false);
  });

  it("given a comment, when Confirmer le renvoi is clicked, then the comment is posted to /send-back, the page says à réécrire and shows the comment, Renvoyer goes while Valider stays (a to_rewrite story can still be validated)", async () => {
    const api = seed("to_validate");
    renderAt("/us/21");
    await loaded();
    click("Renvoyer");
    type(/Commentaire/, "  Précise le cas vide ");

    click("Confirmer le renvoi");

    await waitFor(() => expect(main().textContent).toContain("à réécrire"));
    const writes = api.writes();
    expect(writes.map((c) => [c.method, c.path])).toEqual([
      ["POST", "/api/stories/21/send-back"],
    ]);
    expect(
      (writes[0]?.body as { comment?: string } | undefined)?.comment?.trim(),
    ).toBe("Précise le cas vide");
    expect(main().textContent).toContain("Précise le cas vide");
    expect(maybeButton("Renvoyer")).toBeNull();
    expect(maybeButton("Valider")).not.toBeNull();
    expect(maybeButton("Confirmer le renvoi")).toBeNull();
  });

  it("given the form is open, when Annuler is clicked, then the form closes, nothing is sent and the story stays à valider", async () => {
    const api = seed("to_validate");
    renderAt("/us/21");
    await loaded();
    click("Renvoyer");
    type(/Commentaire/, "Non");

    click("Annuler");

    expect(maybeButton("Confirmer le renvoi")).toBeNull();
    expect(button("Renvoyer")).toBeDefined();
    expect(main().textContent).toContain("à valider");
    expect(api.writes()).toEqual([]);
  });

  it("given a comment, when the server answers 409 wrong_status, then a French alert about the status is shown, never the code", async () => {
    const api = seed("to_validate");
    renderAt("/us/21");
    await loaded();
    click("Renvoyer");
    type(/Commentaire/, "Non");
    api.failNext.sendBack = fail(409, "wrong_status");

    click("Confirmer le renvoi");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/statut/i);
    expect(alert.textContent).not.toContain("wrong_status");
  });

  it("given a comment of more than 2000 characters, when Confirmer le renvoi is clicked and the server answers 400, then a French alert is shown, never the word Bad request", async () => {
    const api = seed("to_validate");
    renderAt("/us/21");
    await loaded();
    click("Renvoyer");
    type(/Commentaire/, "x".repeat(2001));
    api.failNext.sendBack = fail(400, "Bad request");

    click("Confirmer le renvoi");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/bad request/i);
    expect(alert.textContent?.trim()).not.toBe("");
  });
});

describe("criterion 11: the rewrite comment", () => {
  it("given a to_rewrite story, when the page loads, then the comment of the user is shown", async () => {
    seed("to_rewrite");

    renderAt("/us/21");

    await loaded();
    expect(main().textContent).toContain("Précise le cas vide");
  });

  it.each(["to_validate", "ready"])(
    "given a %s story that still carries an old comment, when the page loads, then the comment is not shown",
    async (status) => {
      seed(status, { rewriteComment: "Vieux commentaire" });

      renderAt("/us/21");

      await loaded();
      expect(main().textContent).not.toContain("Vieux commentaire");
    },
  );
});

describe("criterion 11: Abandonner", () => {
  it("given a story, when Abandonner is clicked, then Confirmer l'abandon and Annuler appear on the spot and nothing is sent until the confirmation", async () => {
    const api = seed("ready");
    renderAt("/us/21");
    await loaded();

    click("Abandonner");

    expect(button("Confirmer l'abandon")).toBeDefined();
    expect(button("Annuler")).toBeDefined();
    expect(api.writes()).toEqual([]);
  });

  it("given the confirmation is shown, when Annuler is clicked, then it goes away, nothing is sent and the story stays", async () => {
    const api = seed("ready");
    renderAt("/us/21");
    await loaded();
    click("Abandonner");

    click("Annuler");

    expect(maybeButton("Confirmer l'abandon")).toBeNull();
    expect(button("Abandonner")).toBeDefined();
    expect(main().textContent).toContain("prête");
    expect(api.writes()).toEqual([]);
  });

  it.each([
    "to_validate",
    "to_rewrite",
    "ready",
    "in_progress",
    "in_review",
    "done",
  ])(
    "given a %s story, when the abandon is confirmed, then it posts to /abandon, the page says abandonnée and no decision button is left",
    async (status) => {
      const api = seed(status);
      renderAt("/us/21");
      await loaded();
      click("Abandonner");

      click("Confirmer l'abandon");

      await waitFor(() => expect(main().textContent).toContain("abandonnée"));
      expect(api.writes().map((c) => [c.method, c.path])).toEqual([
        ["POST", "/api/stories/21/abandon"],
      ]);
      expect(within(main()).queryAllByRole("button")).toEqual([]);
    },
  );

  it("given the confirmation, when the server answers 409, then a French alert is shown, never the code, and the story is not shown abandoned", async () => {
    const api = seed("ready");
    renderAt("/us/21");
    await loaded();
    click("Abandonner");
    api.failNext.abandon = fail(409, "project_archived");

    click("Confirmer l'abandon");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/archiv/i);
    expect(alert.textContent).not.toContain("project_archived");
    expect(main().textContent).not.toContain("abandonnée");
  });
});

describe("criterion 11: Modifier", () => {
  it("given a story, when Modifier is clicked, then a form is prefilled with the narrative, the notes and every criterion, with Enregistrer and Annuler", async () => {
    const api = seed("to_validate");
    renderAt("/us/21");
    await loaded();

    click("Modifier");

    const value = (label: string | RegExp, index = 0) =>
      (screen.getAllByLabelText(label)[index] as HTMLInputElement).value;
    expect(value(/En tant que/)).toBe("lectrice attentive");
    expect(value(/Je veux/)).toBe("relire les exports");
    expect(value(/Afin de/)).toBe("corriger les erreurs");
    expect(value(/Notes/)).toBe("des notes");
    expect(screen.getAllByLabelText(/Étant donné/)).toHaveLength(2);
    expect([0, 1].map((i) => value(/Étant donné/, i))).toEqual([
      "donné-alpha",
      "donné-beta",
    ]);
    expect([0, 1].map((i) => value(/Quand/, i))).toEqual([
      "quand-alpha",
      "quand-beta",
    ]);
    expect([0, 1].map((i) => value(/Alors/, i))).toEqual([
      "alors-alpha",
      "alors-beta",
    ]);
    expect(button("Enregistrer")).toBeDefined();
    expect(button("Annuler")).toBeDefined();
    expect(api.writes()).toEqual([]);
  });

  it("given the form, when a criterion is removed, another added and the texts changed, then Enregistrer patches the story with the whole new list in order", async () => {
    const api = seed("to_rewrite");
    renderAt("/us/21");
    await loaded();
    click("Modifier");

    click(/Retirer le critère 1/);
    expect(screen.getAllByLabelText(/Étant donné/)).toHaveLength(1);
    click("Ajouter un critère");
    expect(screen.getAllByLabelText(/Étant donné/)).toHaveLength(2);
    type(/En tant que/, "relectrice");
    type(/Je veux/, "relire vite");
    type(/Afin de/, "gagner du temps");
    type(/Notes/, "nouvelles notes");
    type(/Étant donné/, "donné-gamma", 1);
    type(/Quand/, "quand-gamma", 1);
    type(/Alors/, "alors-gamma", 1);
    click("Enregistrer");

    await waitFor(() => expect(main().textContent).toContain("relire vite"));
    const writes = api.writes();
    expect(writes.map((c) => [c.method, c.path])).toEqual([
      ["PATCH", "/api/stories/21"],
    ]);
    expect(writes[0]?.body).toEqual({
      asA: "relectrice",
      iWant: "relire vite",
      soThat: "gagner du temps",
      notesMd: "nouvelles notes",
      criteria: [
        { given: "donné-beta", when: "quand-beta", then: "alors-beta" },
        { given: "donné-gamma", when: "quand-gamma", then: "alors-gamma" },
      ],
    });
    // The form is closed, the new text is shown, the status did not change.
    expect(maybeButton("Enregistrer")).toBeNull();
    expect(main().textContent).toContain("alors-gamma");
    expect(main().textContent).not.toContain("alors-alpha");
    expect(main().textContent).toContain("à réécrire");
  });

  it("given the form, when Annuler is clicked, then nothing is sent and the old text stays", async () => {
    const api = seed("ready");
    renderAt("/us/21");
    await loaded();
    click("Modifier");
    type(/Je veux/, "autre chose");

    click("Annuler");

    expect(maybeButton("Enregistrer")).toBeNull();
    expect(main().textContent).toContain("relire les exports");
    expect(main().textContent).not.toContain("autre chose");
    expect(api.writes()).toEqual([]);
  });

  it("given the form with a single criterion, when its removal is asked, then the criterion stays (a story keeps at least one)", async () => {
    const api = seed("ready", {
      criteria: [
        { id: 1, position: 1, given: "g", when: "w", then: "t" },
      ] as DecisionStory["criteria"],
    });
    renderAt("/us/21");
    await loaded();
    click("Modifier");

    const remove = screen.queryByRole("button", {
      name: /Retirer le critère 1/,
    }) as HTMLButtonElement | null;
    if (remove && !remove.disabled) fireEvent.click(remove);

    expect(screen.getAllByLabelText(/Étant donné/)).toHaveLength(1);
    expect(api.writes()).toEqual([]);
  });

  it("given the form, when the server answers 400, then a French alert is shown, never Bad request, and the form stays open with the typed text", async () => {
    const api = seed("ready");
    renderAt("/us/21");
    await loaded();
    click("Modifier");
    type(/Je veux/, "texte tapé");
    api.failNext.edit = fail(400, "Bad request");

    click("Enregistrer");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/bad request/i);
    expect(
      (screen.getAllByLabelText(/Je veux/)[0] as HTMLInputElement).value,
    ).toBe("texte tapé");
  });

  it("given the form, when the server answers 409 wrong_status, then a French alert about the status is shown, never the code", async () => {
    const api = seed("ready");
    renderAt("/us/21");
    await loaded();
    click("Modifier");
    api.failNext.edit = fail(409, "wrong_status");

    click("Enregistrer");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/statut/i);
    expect(alert.textContent).not.toContain("wrong_status");
  });
});

describe("criterion 11: an archived project", () => {
  it.each(["to_validate", "to_rewrite", "ready"])(
    "given a %s story of an archived project (project.archived is true in GET /api/stories/:id), when the page loads, then every decision button is shown but disabled",
    async (status) => {
      const api = seed(status, {}, { archived: true });

      renderAt("/us/21");

      await loaded();
      const buttons = within(main()).getAllByRole("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      for (const b of buttons)
        expect((b as HTMLButtonElement).disabled, b.textContent ?? "").toBe(
          true,
        );
      fireEvent.click(button("Abandonner"));
      expect(maybeButton("Confirmer l'abandon")).toBeNull();
      expect(api.writes()).toEqual([]);
    },
  );

  it("given an active project, when the page loads, then no decision button is disabled", async () => {
    seed("to_validate");

    renderAt("/us/21");

    await loaded();
    for (const b of within(main()).getAllByRole("button"))
      expect((b as HTMLButtonElement).disabled, b.textContent ?? "").toBe(
        false,
      );
  });
});

describe("criterion 11: the history of the story", () => {
  const history: HistoryEntry[] = [
    {
      at: "2026-10-28T12:04:00.000Z",
      action: "validate_story",
      result: "ok",
      actor: "human",
    },
    {
      at: "2026-10-28T12:03:00.000Z",
      action: "update_user_story",
      result: "ok",
      actor: "claude",
    },
    {
      at: "2026-10-28T12:02:00.000Z",
      action: "send_back_story",
      result: "refused",
      actor: "human",
    },
    {
      at: "2026-10-28T12:01:00.000Z",
      action: "create_user_stories",
      result: "ok",
      actor: "claude",
    },
  ];

  it("given a story, when the page loads, then the history is a <details> that is collapsed, with a French title", async () => {
    seed("to_validate", {}, { history });

    renderAt("/us/21");

    await loaded();
    const details = main().querySelector("details");
    expect(details, "a <details> section").not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toMatch(
      /historique/i,
    );
  });

  it("given four entries, when the section is opened, then each row says who (Claude or Toi), an action in French, the result in French and a date, newest first, and no code of the server", async () => {
    seed("to_validate", {}, { history });
    renderAt("/us/21");
    await loaded();
    const details = main().querySelector("details") as HTMLDetailsElement;

    const summary = details.querySelector("summary") as HTMLElement;
    fireEvent.click(summary);
    details.open = true;
    fireEvent(details, new Event("toggle"));

    await waitFor(() =>
      expect(within(details).getAllByRole("listitem")).toHaveLength(4),
    );
    const rows = within(details)
      .getAllByRole("listitem")
      .map((r) => r.textContent ?? "");
    expect(rows.map((r) => (r.includes("Toi") ? "Toi" : "Claude"))).toEqual([
      "Toi",
      "Claude",
      "Toi",
      "Claude",
    ]);
    expect(rows[0]).not.toContain("Claude");
    expect(rows[1]).not.toContain("Toi");
    expect(new Set(rows.map((r) => r.replace(/Toi|Claude/, ""))).size).toBe(4);
    expect(rows[2]).toMatch(/refusée/i);
    expect(rows[0]).toMatch(/réussie/i);
    for (const row of rows)
      expect(row).not.toMatch(
        /validate_story|update_user_story|send_back_story|create_user_stories|\bhuman\b|\bclaude\b|\bok\b|refused/,
      );
    expect(rows[0]).toMatch(/valid/i);
    expect(rows[2]).toMatch(/renvo/i);
  });
});
