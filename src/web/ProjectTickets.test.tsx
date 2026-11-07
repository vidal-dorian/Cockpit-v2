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

/** The list item that holds a ticket title. */
const rowOf = (title: string) => {
  const row = screen.getByText(title).closest("li");
  expect(row, `${title} must be inside a list item`).not.toBeNull();
  return row as HTMLElement;
};

const create = (title: string, description?: string) => {
  fireEvent.change(screen.getByLabelText("Titre"), {
    target: { value: title },
  });
  if (description !== undefined)
    fireEvent.change(screen.getByLabelText("Description (markdown)"), {
      target: { value: description },
    });
  fireEvent.click(screen.getByRole("button", { name: "Créer" }));
};

describe("Project page, the tickets", () => {
  it("given two tickets, when /projets/:id loads, then a Tickets section lists them in the API order, each a link to /tickets/:id with its step Nouveau", async () => {
    stubTicketApi([ticket(8, "Plus récent"), ticket(7, "Plus ancien")]);

    renderAt("/projets/5/tickets");

    await screen.findByRole("heading", { name: "Tickets" });
    const newer = await screen.findByRole("link", { name: "Plus récent" });
    const older = screen.getByRole("link", { name: "Plus ancien" });
    expect(newer.getAttribute("href")).toBe("/tickets/8");
    expect(older.getAttribute("href")).toBe("/tickets/7");
    expect(
      newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(rowOf("Plus récent")).getByText("Nouveau")).toBeDefined();
    expect(within(rowOf("Plus ancien")).getByText("Nouveau")).toBeDefined();
  });

  it("given a project without ticket, when the page loads, then it says there is none yet and offers the Nouveau ticket form", async () => {
    stubTicketApi([]);

    renderAt("/projets/5/tickets");

    await screen.findByText(/Aucun ticket/);
    expect(screen.getByText("Nouveau ticket")).toBeDefined();
    expect(screen.getByLabelText("Titre")).toBeDefined();
    expect(screen.getByRole("button", { name: "Créer" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("given the form, when a title is typed and Créer is clicked, then the ticket is sent for this project and shown at the top of the list, and the field is emptied", async () => {
    const api = stubTicketApi([ticket(7, "Déjà là")]);
    renderAt("/projets/5/tickets");
    await screen.findByRole("link", { name: "Déjà là" });

    create("Ajouter la recherche");

    const link = await screen.findByRole("link", {
      name: "Ajouter la recherche",
    });
    expect(api.writes()).toEqual([
      {
        method: "POST",
        path: "/api/projects/5/tickets",
        body: { title: "Ajouter la recherche" },
      },
    ]);
    const links = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/tickets/"));
    expect(links.map((l) => l.textContent)).toEqual([
      "Ajouter la recherche",
      "Déjà là",
    ]);
    expect(link.getAttribute("href")).toBe("/tickets/100");
    expect(
      within(rowOf("Ajouter la recherche")).getByText("Nouveau"),
    ).toBeDefined();
    expect((screen.getByLabelText("Titre") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/Aucun ticket/)).toBeNull();
  });

  it("given the Nouveau ticket form, when the page loads, then it shows an empty Description (markdown) textarea", async () => {
    stubTicketApi([]);

    renderAt("/projets/5/tickets");

    await screen.findByText(/Aucun ticket/);
    const description = screen.getByLabelText("Description (markdown)");
    expect(description.tagName).toBe("TEXTAREA");
    expect((description as HTMLTextAreaElement).value).toBe("");
  });

  it("given a title only, when Créer is clicked, then the request holds exactly { title } with no descriptionMd", async () => {
    const api = stubTicketApi([]);
    renderAt("/projets/5/tickets");
    await screen.findByText(/Aucun ticket/);

    create("Capture rapide");

    await screen.findByRole("link", { name: "Capture rapide" });
    expect(api.writes()).toEqual([
      {
        method: "POST",
        path: "/api/projects/5/tickets",
        body: { title: "Capture rapide" },
      },
    ]);
    expect(Object.keys(api.writes()[0]?.body as object)).toEqual(["title"]);
  });

  it("given a title and a description, when Créer is clicked, then { title, descriptionMd } is sent as typed and both fields are emptied", async () => {
    const api = stubTicketApi([]);
    renderAt("/projets/5/tickets");
    await screen.findByText(/Aucun ticket/);
    const markdown = "  ## Contexte\n\n- un **point**\n";

    create("Ajouter la recherche", markdown);

    await screen.findByRole("link", { name: "Ajouter la recherche" });
    expect(api.writes()).toEqual([
      {
        method: "POST",
        path: "/api/projects/5/tickets",
        body: { title: "Ajouter la recherche", descriptionMd: markdown },
      },
    ]);
    expect((screen.getByLabelText("Titre") as HTMLInputElement).value).toBe("");
    expect(
      (screen.getByLabelText("Description (markdown)") as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });

  it("given the server refuses the ticket (400), when Créer is clicked with a title and a description, then both fields keep what was typed", async () => {
    const api = stubTicketApi([]);
    api.failNext.post = fail(400, "Bad request");
    renderAt("/projets/5/tickets");
    await screen.findByText(/Aucun ticket/);

    create("   ", "du **texte**");

    await screen.findByRole("alert");
    expect((screen.getByLabelText("Titre") as HTMLInputElement).value).toBe(
      "   ",
    );
    expect(
      (screen.getByLabelText("Description (markdown)") as HTMLTextAreaElement)
        .value,
    ).toBe("du **texte**");
  });

  it("given the server refuses the title (400), when Créer is clicked, then a French alert talks about the title, keeps what was typed and shows no internal text", async () => {
    const api = stubTicketApi([]);
    api.failNext.post = fail(400, "Bad request");
    renderAt("/projets/5/tickets");
    await screen.findByText(/Aucun ticket/);

    create("   ");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/titre/i);
    expect(alert.textContent).not.toMatch(/Bad request|400/);
    expect(screen.queryByRole("link", { name: /^$/ })).toBeNull();
    expect(screen.getByText(/Aucun ticket/)).toBeDefined();
  });

  it("given an archived project (409 project_archived), when Créer is clicked, then a French alert says the project is archived and the code is not shown", async () => {
    const api = stubTicketApi([]);
    api.failNext.post = fail(409, "project_archived");
    renderAt("/projets/5/tickets");
    await screen.findByText(/Aucun ticket/);

    create("Trop tard");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/archiv/i);
    expect(alert.textContent).not.toContain("project_archived");
    expect(screen.queryByRole("link", { name: "Trop tard" })).toBeNull();
  });

  it("given a ticket in the list, when its title is clicked, then the ticket page opens on /tickets/:id", async () => {
    stubTicketApi([ticket(7, "Ouvre-moi", "du texte")]);
    renderAt("/projets/5/tickets");

    fireEvent.click(await screen.findByRole("link", { name: "Ouvre-moi" }));

    await waitFor(() => expect(window.location.pathname).toBe("/tickets/7"));
    await screen.findByRole("heading", { level: 1, name: /^Ouvre-moi/ });
  });
});
