// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt } from "./test-tickets.tsx";
import { projects, rich, stubBar, stubTab } from "./test-tickets-full.tsx";

// Slice 11.2, decision 054 D (S09): Enter in the idea bar opens a panel instead of creating.
//
// Pinned choices (the decision leaves them open):
// - The bar keeps its form « Noter une idée », its field « Idée », its select « Projet » and its button « Noter l'idée » (↑):
//   Enter in the field and a click on the button do the same thing, they open the panel and never create. A blank title opens nothing.
// - The panel is a `role="dialog"` named « Noter une idée », with an <h2> « Noter une idée » and the sentence « Claude en écrira les user stories ».
//   It is not a form (the bar already is the form of that name). It is absent until opened.
// - Fields of the panel: textbox « Titre » (the typed title, editable), textarea « Description » (markdown), select « Projet » (the page's project,
//   else the first one; every project of the user), select « Priorité » whose options read « Priorité : basse », « Priorité : normale » (default),
//   « Priorité : haute » (values low, normal, high), textbox « Étiquette » (placeholder « + étiquette »).
// - A tag typed then Enter becomes a chip: the tag is normalised on the page like the server does (trim, inner spaces to one, lowercase), an empty tag
//   or one already there adds nothing, the field is emptied. A chip is its text and a button « Retirer l'étiquette <tag> ». Enter in that field never sends the idea.
// - Suggestions are the <option>s of the <datalist> of the tag field: the distinct tags of GET /api/projects/:id/tickets of the chosen project.
// - Footer: the sentence « Seuls le titre et le projet sont obligatoires. », the button « Annuler » and the button « Noter » (its name starts with Noter, and it shows « Ctrl Entrée »).
//   « Noter » is disabled while the title is blank.
// - « Noter » and Ctrl+Enter (anywhere in the panel) POST /api/projects/:chosen/tickets with { title (trimmed), descriptionMd (only when not empty), priority, tags }:
//   priority and tags are always sent. Then the panel closes, the bar field is emptied and the status « Idée notée dans <repo>. » shows (as before).
// - « Annuler » and Escape close the panel without any request and leave the title in the bar.
// - A refusal keeps the panel open, with what was typed, and shows the sentence of the refusal in a role="alert".

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const bar = async () =>
  within(await screen.findByRole("form", { name: "Noter une idée" }));
const barField = async () =>
  (await bar()).getByRole("textbox", { name: "Idée" }) as HTMLInputElement;
const open = async (title = "ranger le Kanban") => {
  fireEvent.change(await barField(), { target: { value: title } });
  fireEvent.keyDown(await barField(), { key: "Enter" });
  fireEvent.submit(await screen.findByRole("form", { name: "Noter une idée" }));
};
const dialog = () => screen.findByRole("dialog", { name: "Noter une idée" });
const inPanel = async () => within(await dialog());
const noter = async () =>
  (await inPanel()).getByRole("button", { name: /^Noter/ });
const tag = async (text: string) => {
  const input = (await inPanel()).getByRole("textbox", { name: "Étiquette" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
};
const posts = (api: {
  sent: { method: string; path: string; body: unknown }[];
}) =>
  api.sent.filter(
    (s) =>
      s.method === "POST" && /^\/api\/projects\/\d+\/tickets$/.test(s.path),
  );

describe("054 D: Enter opens the panel", () => {
  it("given a title in the bar, when Enter is pressed, then nothing is created and the panel « Noter une idée » opens with its title prefilled", async () => {
    const api = stubBar();
    renderAt("/");

    await open("Exporter les factures");

    const panel = await inPanel();
    expect(
      panel.getByRole("heading", { level: 2, name: "Noter une idée" }),
    ).toBeDefined();
    expect(panel.getByText("Claude en écrira les user stories")).toBeDefined();
    expect(
      (panel.getByRole("textbox", { name: "Titre" }) as HTMLInputElement).value,
    ).toBe("Exporter les factures");
    expect(posts(api)).toEqual([]);
  });

  it("given the page, when no idea was typed or the title is blank, then no panel is there", async () => {
    stubBar();
    renderAt("/");

    await barField();
    expect(screen.queryByRole("dialog", { name: "Noter une idée" })).toBeNull();
    await open("   ");
    expect(screen.queryByRole("dialog", { name: "Noter une idée" })).toBeNull();
  });

  it("given the panel, when it opens, then it holds the Titre, Description, Projet, Priorité « Priorité : normale » and Étiquette fields, the footer sentence, Annuler and Noter with Ctrl Entrée", async () => {
    stubBar();
    renderAt("/");

    await open();

    const panel = await inPanel();
    expect(panel.getByRole("textbox", { name: "Titre" })).toBeDefined();
    expect(panel.getByRole("textbox", { name: "Description" }).tagName).toBe(
      "TEXTAREA",
    );
    const priority = panel.getByRole("combobox", {
      name: "Priorité",
    }) as HTMLSelectElement;
    expect([...priority.options].map((o) => [o.value, o.textContent])).toEqual([
      ["low", "Priorité : basse"],
      ["normal", "Priorité : normale"],
      ["high", "Priorité : haute"],
    ]);
    expect(priority.selectedOptions[0]?.textContent).toBe("Priorité : normale");
    expect(
      (panel.getByRole("textbox", { name: "Étiquette" }) as HTMLInputElement)
        .placeholder,
    ).toBe("+ étiquette");
    expect(
      panel.getByText("Seuls le titre et le projet sont obligatoires."),
    ).toBeDefined();
    expect(panel.getByRole("button", { name: "Annuler" })).toBeDefined();
    expect((await noter()).textContent).toContain("Ctrl Entrée");
  });

  it("given the panel, when the title is edited, then Noter sends the edited title", async () => {
    const api = stubBar();
    renderAt("/");
    await open("brouillon");

    fireEvent.change(
      (await inPanel()).getByRole("textbox", { name: "Titre" }),
      {
        target: { value: "  Titre corrigé " },
      },
    );
    fireEvent.click(await noter());

    await waitFor(() => expect(posts(api)).toHaveLength(1));
    expect(posts(api)[0]?.body).toMatchObject({ title: "Titre corrigé" });
  });

  it("given a blank title in the panel, when it is looked at, then Noter is disabled", async () => {
    stubBar();
    renderAt("/");
    await open();

    fireEvent.change(
      (await inPanel()).getByRole("textbox", { name: "Titre" }),
      {
        target: { value: "   " },
      },
    );

    expect((await noter()).hasAttribute("disabled")).toBe(true);
  });
});

describe("054 D: the project of the panel", () => {
  it("given the user is on /projets/5, when the panel opens, then its project is that one", async () => {
    stubTab([rich(7, "Un ticket")]);
    renderAt("/projets/5/tickets");

    await open();

    const select = (await inPanel()).getByRole("combobox", {
      name: "Projet",
    }) as HTMLSelectElement;
    expect(select.value).toBe("5");
    expect(select.options).toHaveLength(projects.length);
  });

  it("given another project is chosen in the panel, when Noter is clicked, then the idea goes to that project", async () => {
    const api = stubBar();
    renderAt("/");
    await open();

    fireEvent.change(
      (await inPanel()).getByRole("combobox", { name: "Projet" }),
      {
        target: { value: "8" },
      },
    );
    fireEvent.click(await noter());

    await waitFor(() => expect(posts(api)).toHaveLength(1));
    expect(posts(api)[0]?.path).toBe("/api/projects/8/tickets");
    expect((await screen.findByRole("status")).textContent).toContain(
      "Idée notée dans world.",
    );
  });
});

describe("054 D: the tags of the panel", () => {
  it("given a tag typed with capitals and spaces, when Enter is pressed, then a chip shows it normalised, the field is emptied and nothing is sent", async () => {
    const api = stubBar();
    renderAt("/");
    await open();

    await tag("  Export   Mensuel ");

    const panel = await inPanel();
    expect(panel.getByText("export mensuel")).toBeDefined();
    expect(
      panel.getByRole("button", { name: "Retirer l'étiquette export mensuel" }),
    ).toBeDefined();
    expect(
      (panel.getByRole("textbox", { name: "Étiquette" }) as HTMLInputElement)
        .value,
    ).toBe("");
    expect(posts(api)).toEqual([]);
  });

  it("given a tag already there and an empty one, when Enter is pressed, then no chip is added", async () => {
    stubBar();
    renderAt("/");
    await open();

    await tag("export");
    await tag("EXPORT");
    await tag("   ");

    const panel = await inPanel();
    expect(
      panel.getAllByRole("button", { name: /^Retirer l'étiquette / }),
    ).toHaveLength(1);
  });

  it("given a chip, when its remove button is clicked, then it is gone and not sent", async () => {
    const api = stubBar();
    renderAt("/");
    await open();
    await tag("garde");
    await tag("retire");

    fireEvent.click(
      (await inPanel()).getByRole("button", {
        name: "Retirer l'étiquette retire",
      }),
    );
    fireEvent.click(await noter());

    await waitFor(() => expect(posts(api)).toHaveLength(1));
    expect(posts(api)[0]?.body).toMatchObject({ tags: ["garde"] });
  });

  it("given tags used in two projects, when the panel opens and then another project is chosen, then the suggestions are the tags of the chosen project", async () => {
    stubBar({
      ticketsOf: {
        5: [
          rich(1, "a", { tags: ["export", "auth"] }),
          rich(2, "b", { tags: ["auth"] }),
        ],
        8: [rich(3, "c", { tags: ["zèbre"] })],
      },
    });
    renderAt("/");
    await open();
    const panel = await inPanel();
    const input = panel.getByRole("textbox", { name: "Étiquette" });
    const suggestions = () => {
      const list = document.getElementById(input.getAttribute("list") ?? "");
      return [...(list?.querySelectorAll("option") ?? [])]
        .map((o) => o.getAttribute("value"))
        .sort();
    };

    await waitFor(() => expect(suggestions()).toEqual(["auth", "export"]));
    fireEvent.change(panel.getByRole("combobox", { name: "Projet" }), {
      target: { value: "8" },
    });

    await waitFor(() => expect(suggestions()).toEqual(["zèbre"]));
  });
});

describe("054 D: Noter", () => {
  it("given every field filled, when Noter is clicked, then { title, descriptionMd, priority, tags } is sent, the panel closes, the bar is emptied and Idée notée is said", async () => {
    const api = stubBar();
    renderAt("/");
    await open("Exporter en CSV");
    const panel = await inPanel();
    fireEvent.change(panel.getByRole("textbox", { name: "Description" }), {
      target: { value: "Un fichier **par mois**" },
    });
    fireEvent.change(panel.getByRole("combobox", { name: "Priorité" }), {
      target: { value: "high" },
    });
    await tag("Export");
    await tag("compta");

    fireEvent.click(await noter());

    await waitFor(() =>
      expect(posts(api)).toEqual([
        {
          method: "POST",
          path: "/api/projects/5/tickets",
          body: {
            title: "Exporter en CSV",
            descriptionMd: "Un fichier **par mois**",
            priority: "high",
            tags: ["export", "compta"],
          },
        },
      ]),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Noter une idée" }),
      ).toBeNull(),
    );
    expect((await screen.findByRole("status")).textContent).toContain(
      "Idée notée dans hello.",
    );
    expect((await barField()).value).toBe("");
  });

  it("given a title only, when Noter is clicked, then the body is { title, priority: normal, tags: [] } with no descriptionMd", async () => {
    const api = stubBar();
    renderAt("/");
    await open("Juste un titre");

    fireEvent.click(await noter());

    await waitFor(() => expect(posts(api)).toHaveLength(1));
    expect(posts(api)[0]?.body).toEqual({
      title: "Juste un titre",
      priority: "normal",
      tags: [],
    });
  });

  it("given the focus in the description, when Ctrl+Enter is pressed, then the idea is sent like Noter does and the panel closes", async () => {
    const api = stubBar();
    renderAt("/");
    await open("Au clavier");
    const description = (await inPanel()).getByRole("textbox", {
      name: "Description",
    });
    fireEvent.change(description, { target: { value: "texte" } });

    fireEvent.keyDown(description, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(posts(api)).toHaveLength(1));
    expect(posts(api)[0]?.body).toEqual({
      title: "Au clavier",
      descriptionMd: "texte",
      priority: "normal",
      tags: [],
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Noter une idée" }),
      ).toBeNull(),
    );
  });

  it("given the server refuses the idea, when Noter is clicked, then the panel stays open with what was typed and the sentence of the refusal shows", async () => {
    stubBar({ ticketStatus: 500 });
    renderAt("/");
    await open("Refusée");

    fireEvent.click(await noter());

    expect(
      await screen.findByText("L'opération a échoué, réessaie."),
    ).toBeDefined();
    const panel = await inPanel();
    expect(
      (panel.getByRole("textbox", { name: "Titre" }) as HTMLInputElement).value,
    ).toBe("Refusée");
  });
});

describe("054 D: Annuler and Escape", () => {
  it("given the panel, when Annuler is clicked, then it closes, nothing was sent and the title is still in the bar", async () => {
    const api = stubBar();
    renderAt("/");
    await open("Je garde ça");

    fireEvent.click((await inPanel()).getByRole("button", { name: "Annuler" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Noter une idée" }),
      ).toBeNull(),
    );
    expect((await barField()).value).toBe("Je garde ça");
    expect(posts(api)).toEqual([]);
  });

  it("given the panel, when Escape is pressed in it, then it closes, nothing was sent and the title is still in the bar", async () => {
    const api = stubBar();
    renderAt("/");
    await open("Échap");

    fireEvent.keyDown(
      (await inPanel()).getByRole("textbox", { name: "Description" }),
      { key: "Escape" },
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Noter une idée" }),
      ).toBeNull(),
    );
    expect((await barField()).value).toBe("Échap");
    expect(posts(api)).toEqual([]);
  });

  it("given the panel was closed with Annuler, when n is pressed outside a field, then the bar field gets the focus", async () => {
    stubBar();
    renderAt("/");
    await open("Encore");
    fireEvent.click((await inPanel()).getByRole("button", { name: "Annuler" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Noter une idée" }),
      ).toBeNull(),
    );

    fireEvent.keyDown(document.body, { key: "n" });

    expect(document.activeElement).toBe(await barField());
  });
});
