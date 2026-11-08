// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fail, renderAt, stubTicketApi, ticket } from "./test-tickets.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Ticket page, reading", () => {
  it("given a ticket, when /tickets/:id loads, then h1 is its title, its step reads Nouveau and a link leads back to its project", async () => {
    stubTicketApi([ticket(7, "Ajouter la recherche", "du texte")]);

    renderAt("/tickets/7");

    await screen.findByRole("heading", {
      level: 1,
      name: /^Ajouter la recherche/,
    });
    expect(within(main()).getByText("Nouveau")).toBeDefined();
    // Decision 028 G: the "←" link leads to the Tickets tab of the project.
    const back = main().querySelector('a[href="/projets/5/tickets"]');
    expect(back, "a link to /projets/5/tickets inside the page").not.toBeNull();
  });

  it("given a markdown description, when the page loads, then bold text, a heading, a list and a link are rendered as HTML", async () => {
    stubTicketApi([
      ticket(
        7,
        "Markdown",
        "Du **gras** et [un lien](https://example.com/doc)\n\n## Sous-titre\n\n- premier\n- second\n",
      ),
    ]);

    renderAt("/tickets/7");

    await screen.findByRole("heading", { level: 1, name: /^Markdown/ });
    const strong = within(main()).getByText("gras");
    expect(strong.tagName).toBe("STRONG");
    const link = within(main()).getByRole("link", { name: "un lien" });
    expect(link.getAttribute("href")).toBe("https://example.com/doc");
    expect(
      within(main()).getByRole("heading", { name: "Sous-titre" }),
    ).toBeDefined();
    const items = within(main()).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["premier", "second"]);
    expect(main().textContent).not.toContain("**");
  });

  it("given a description with raw HTML, when the page loads, then no element, script or event handler comes from it (text or nothing, never HTML)", async () => {
    stubTicketApi([
      ticket(
        7,
        "Piégé",
        'Avant <img src=x onerror=alert(1)> milieu <script>window.__pwned = 1</script> <b onclick="alert(2)">gras HTML</b>\n\n[clic](javascript:alert(3))',
      ),
    ]);

    renderAt("/tickets/7");

    await screen.findByRole("heading", { level: 1, name: /^Piégé/ });
    expect(main().querySelector("img")).toBeNull();
    expect(main().querySelector("script")).toBeNull();
    expect(main().querySelector("b")).toBeNull();
    expect(document.querySelector("[onerror], [onclick]")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    for (const a of main().querySelectorAll("a")) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/^\s*javascript:/i);
    }
  });

  it("given a markdown image in the description, when the page loads, then no image is rendered or requested (remote images are blocked)", async () => {
    stubTicketApi([
      ticket(
        7,
        "Image",
        "Avant\n\n![x](https://tracker.example/p.png)\n\nAprès",
      ),
    ]);

    renderAt("/tickets/7");

    await screen.findByRole("heading", { level: 1, name: /^Image/ });
    expect(within(main()).getByText(/Avant/)).toBeDefined();
    expect(within(main()).getByText(/Après/)).toBeDefined();
    expect(main().querySelector("img")).toBeNull();
    expect(document.querySelector('[src*="tracker.example"]')).toBeNull();
  });

  it.each(["999", "abc"])(
    "given the ticket %s does not exist for the user, when its page loads, then it reads Ticket introuvable",
    async (id) => {
      stubTicketApi([ticket(7, "Autre")]);

      renderAt(`/tickets/${id}`);

      await screen.findByText(/Ticket introuvable/);
      expect(screen.queryByRole("heading", { name: "Autre" })).toBeNull();
    },
  );
});

describe("Ticket page, editing", () => {
  it("given a ticket, when Modifier is clicked, then a form offers Titre and Description (markdown) filled with the current values, with Enregistrer and Annuler", async () => {
    stubTicketApi([ticket(7, "Titre actuel", "texte **actuel**")]);
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Titre actuel/ });

    click("Modifier");

    expect((screen.getByLabelText("Titre") as HTMLInputElement).value).toBe(
      "Titre actuel",
    );
    expect(
      (screen.getByLabelText("Description (markdown)") as HTMLTextAreaElement)
        .value,
    ).toBe("texte **actuel**");
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDefined();
    // The Modifier button is gone: the keyboard focus goes to the first field.
    expect(document.activeElement).toBe(screen.getByLabelText("Titre"));
  });

  it("given the form, when both fields change and Enregistrer is clicked, then the changes are sent, the form closes and the page shows the new title and description", async () => {
    const api = stubTicketApi([ticket(7, "Avant", "ancien")]);
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Avant/ });
    click("Modifier");

    type("Titre", "Après");
    type("Description (markdown)", "un **nouveau** texte");
    click("Enregistrer");

    await screen.findByRole("heading", { level: 1, name: /^Après/ });
    expect(api.writes()).toHaveLength(1);
    expect(api.writes()[0]).toMatchObject({
      method: "PATCH",
      path: "/api/tickets/7",
      body: { title: "Après", descriptionMd: "un **nouveau** texte" },
    });
    expect(within(main()).getByText("nouveau").tagName).toBe("STRONG");
    expect(screen.queryByLabelText("Titre")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enregistrer" })).toBeNull();
    expect(within(main()).getByText("Nouveau")).toBeDefined();
    // The form is gone: the keyboard focus goes back to the button that opened it.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Modifier" }),
    );
  });

  it("given the form with changes, when Annuler is clicked, then nothing is sent and the old title stays", async () => {
    const api = stubTicketApi([ticket(7, "Intact", "intact")]);
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Intact/ });
    click("Modifier");
    type("Titre", "Abandonné");

    click("Annuler");

    expect(screen.queryByLabelText("Titre")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: /^Intact/ }),
    ).toBeDefined();
    expect(api.writes()).toEqual([]);
    // The form is gone: the keyboard focus goes back to the button that opened it.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Modifier" }),
    );
  });

  it("given an empty title, when Enregistrer is clicked and the server answers 400, then a French alert talks about the title and the form stays open with what was typed", async () => {
    const api = stubTicketApi([ticket(7, "Avant")]);
    api.failNext.patch = fail(400, "Bad request");
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Avant/ });
    click("Modifier");
    type("Titre", "  ");

    click("Enregistrer");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/titre/i);
    expect(alert.textContent).not.toMatch(/Bad request|400/);
    expect((screen.getByLabelText("Titre") as HTMLInputElement).value).toBe(
      "  ",
    );
  });

  it("given the project got archived, when Enregistrer is clicked and the server answers 409, then a French alert says the project is archived", async () => {
    const api = stubTicketApi([ticket(7, "Avant")]);
    api.failNext.patch = fail(409, "project_archived");
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Avant/ });
    click("Modifier");
    type("Titre", "Après");

    click("Enregistrer");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/archiv/i);
    expect(alert.textContent).not.toContain("project_archived");
  });
});

describe("Ticket page, deleting", () => {
  it("given a ticket, when Supprimer is clicked, then Confirmer la suppression and Annuler appear on the spot and nothing is sent until the confirmation", async () => {
    const api = stubTicketApi([ticket(7, "À jeter")]);
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^À jeter/ });

    click("Supprimer");

    expect(
      screen.getByRole("button", { name: "Confirmer la suppression" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDefined();
    expect(api.writes()).toEqual([]);
    expect(window.location.pathname).toBe("/tickets/7");
    // The Supprimer button is gone: the keyboard focus stays on the safe choice.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Annuler" }),
    );
  });

  it("given the confirmation is shown, when Annuler is clicked, then it goes away, nothing is sent and the ticket stays", async () => {
    const api = stubTicketApi([ticket(7, "Reste")]);
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Reste/ });
    click("Supprimer");

    click("Annuler");

    expect(
      screen.queryByRole("button", { name: "Confirmer la suppression" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeDefined();
    // The confirmation is gone: the keyboard focus goes back to the button that opened it.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Supprimer" }),
    );
    expect(api.writes()).toEqual([]);
    expect(
      screen.getByRole("heading", { level: 1, name: /^Reste/ }),
    ).toBeDefined();
  });

  it("given the confirmation is shown, when Confirmer la suppression is clicked, then the ticket is deleted and the project page shows the list without it", async () => {
    const api = stubTicketApi([ticket(7, "Disparaît"), ticket(6, "Survit")]);
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Disparaît/ });
    click("Supprimer");

    click("Confirmer la suppression");

    await waitFor(() => expect(window.location.pathname).toBe("/projets/5"));
    // The project page opens on its Kanban, whose heading is a sentence (045 D): its Tickets tab says it has loaded.
    // Decision 028 G: the tickets are listed in the Tickets tab, not on the Kanban tab the project opens on.
    fireEvent.click(await screen.findByRole("link", { name: "Tickets" }));
    // Decision 055 F: a row is a button that opens the panel.
    await screen.findByRole("button", { name: "Survit" });
    expect(screen.queryByRole("button", { name: "Disparaît" })).toBeNull();
    expect(api.writes()).toEqual([
      { method: "DELETE", path: "/api/tickets/7", body: undefined },
    ]);
  });
});
