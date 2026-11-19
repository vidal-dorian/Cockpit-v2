// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issue, stubImport } from "./test-issue-import.tsx";
import { renderAt } from "./test-tickets.tsx";
import { layer } from "./test-tickets-full.tsx";

// Decision 085 C, D (slice S04): the import screen links what it names and says what comes next.
// Pinned: in « Déjà dans Cockpit » the whole subtitle « déjà dans Cockpit (US 43) » is the link (href /us/43; /tickets/12 for a ticket);
// the title keeps its text and a link « Voir l'issue #57 sur GitHub » (new tab) follows it; after an import the message offers
// « Écrire les US maintenant » (a routine is connected) and, when stories were imported, a link « N US prêtes au Kanban » to /projets/5.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const ISSUES = [
  issue(58, "Exporter les tâches en PDF", { kind: "story" }),
  issue(59, "Filtrer par étiquette", { kind: "story" }),
  issue(57, "Le bouton Enregistrer ne répond pas sur Safari"),
  issue(55, "Ajouter un mode sombre"),
  issue(61, "Lien expiré ou déjà utilisé", { inCockpit: { storyId: 43 } }),
  issue(62, "Un ticket déjà là", { inCockpit: { ticketId: 12 } }),
];

describe("085 C: the rows of the import screen are links", () => {
  it("given issues already in Cockpit, when the chip Déjà dans Cockpit is clicked, then the subtitles lead to /us/43 and /tickets/12", async () => {
    stubImport(ISSUES);
    renderAt("/projets/5/tickets/importer");
    fireEvent.click(
      await screen.findByRole("button", { name: "Déjà dans Cockpit · 2" }),
    );

    const story = await screen.findByRole("link", {
      name: "déjà dans Cockpit (US 43)",
    });
    const ticket = screen.getByRole("link", {
      name: "déjà dans Cockpit (ticket 12)",
    });

    expect(story.getAttribute("href")).toBe("/us/43");
    expect(ticket.getAttribute("href")).toBe("/tickets/12");
  });

  it("given an issue to import, when the screen loads, then a link opens the issue on GitHub in a new tab", async () => {
    stubImport(ISSUES);
    renderAt("/projets/5/tickets/importer");

    const link = await screen.findByRole("link", {
      name: "Voir l'issue #57 sur GitHub",
    });

    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/issues/57",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

describe("085 D: after the import, the next steps", () => {
  const importAll = async () => {
    fireEvent.click(
      await screen.findByRole("button", { name: "Importer 4 issues" }),
    );
  };

  it("given two stories and two tickets imported and a routine connected, when the import succeeds, then the message offers Écrire les US maintenant and a link « 2 US prêtes au Kanban » to /projets/5", async () => {
    stubImport(ISSUES);
    const { runs } = layer({
      routineConnected: true,
      schedule: { frequency: "daily", hour: 7 },
    });
    renderAt("/projets/5/tickets/importer");

    await importAll();

    const ready = await screen.findByRole("link", {
      name: /2 US prêtes au Kanban/,
    });
    expect(ready.getAttribute("href")).toBe("/projets/5");
    fireEvent.click(
      await screen.findByRole("button", { name: "Écrire les US maintenant" }),
    );
    await waitFor(() => expect(runs).toEqual(["5"]));
  });

  it("given only tickets imported, when the import succeeds, then there is no link to ready stories", async () => {
    stubImport(ISSUES.filter((i) => i.kind === "ticket" && !i.inCockpit));
    layer({
      routineConnected: true,
      schedule: { frequency: "daily", hour: 7 },
    });
    renderAt("/projets/5/tickets/importer");

    fireEvent.click(
      await screen.findByRole("button", { name: "Importer 2 issues" }),
    );

    await screen.findByRole("button", { name: "Écrire les US maintenant" });
    expect(
      within(screen.getByRole("main")).queryByRole("link", {
        name: /US prêtes?/,
      }),
    ).toBeNull();
  });
});
