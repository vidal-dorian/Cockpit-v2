// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFile, layerFiles, withCount } from "./test-attachments.tsx";
import { renderAt } from "./test-tickets.tsx";
import { rich, stubTab } from "./test-tickets-full.tsx";

// Slice 11.4, decision 061 G (S14): attachments on the Tickets tab.
//
// Pinned choices (the decision leaves them open):
// - GET /api/projects/:id/tickets gives each ticket `attachmentsCount` (a number; a missing one counts as 0).
// - The row of a ticket with attachments shows « 📎 N » (N the count) next to its step, in the row's <li> and outside the title button; a ticket with none shows no 📎.
// - The panel of a ticket (role complementary « Ticket ») with attachments has an <h3> « Pièces jointes » and lists the files by name (read from GET /api/tickets/:id/attachments);
//   a ticket without attachment has no such heading. The names are text or download links, never HTML.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const A = withCount(11, "Exporter en CSV", 1);
const B = withCount(12, "Connexion sans mot de passe", 3);
const C = rich(13, "Thème sombre");
const FILES = {
  12: [
    fakeFile(1, "maquette.png", "image/png", 5_000),
    fakeFile(2, "retours.pdf", "application/pdf", 90_000),
    fakeFile(3, "notes.md", "text/markdown", 300),
  ],
};
const rowOf = async (title: string) =>
  (await screen.findByRole("button", { name: title })).closest(
    "li",
  ) as HTMLElement;

describe("061 G: the count on a row", () => {
  it("given tickets with 1, 3 and no attachments, when the tab loads, then the rows read « 📎 1 », « 📎 3 » and nothing", async () => {
    stubTab([A, B, C]);
    layerFiles();
    renderAt("/projets/5/tickets");

    expect((await rowOf("Exporter en CSV")).textContent).toContain("📎 1");
    expect((await rowOf("Connexion sans mot de passe")).textContent).toContain(
      "📎 3",
    );
    expect((await rowOf("Thème sombre")).textContent).not.toContain("📎");
  });

  it("given a ticket whose count is 0, when the tab loads, then its row shows no paperclip", async () => {
    stubTab([A, withCount(14, "Sans pièce", 0)]);
    layerFiles();
    renderAt("/projets/5/tickets");

    expect((await rowOf("Exporter en CSV")).textContent).toContain("📎 1");
    expect((await rowOf("Sans pièce")).textContent).not.toContain("📎");
  });
});

describe("061 G: the panel", () => {
  it("given a ticket with three attachments, when its row is clicked, then the panel lists them by name under « Pièces jointes »", async () => {
    stubTab([A, B, C]);
    layerFiles({ files: FILES });
    renderAt("/projets/5/tickets");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Connexion sans mot de passe",
      }),
    );

    const aside = within(
      await screen.findByRole("complementary", { name: "Ticket" }),
    );
    expect(
      aside.getByRole("heading", { level: 3, name: "Pièces jointes" }),
    ).toBeDefined();
    for (const name of ["maquette.png", "retours.pdf", "notes.md"])
      expect(await aside.findByText(name)).toBeDefined();
  });

  it("given a ticket without attachment, when its row is clicked after one with attachments, then the panel has no « Pièces jointes » heading any more", async () => {
    stubTab([A, B, C]);
    layerFiles({ files: FILES });
    renderAt("/projets/5/tickets");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Connexion sans mot de passe",
      }),
    );
    await within(
      await screen.findByRole("complementary", { name: "Ticket" }),
    ).findByRole("heading", { level: 3, name: "Pièces jointes" });

    fireEvent.click(
      await screen.findByRole("button", { name: "Thème sombre" }),
    );

    const aside = within(
      await screen.findByRole("complementary", { name: "Ticket" }),
    );
    await aside.findByRole("heading", { level: 2, name: "Thème sombre" });
    expect(aside.queryByRole("heading", { name: "Pièces jointes" })).toBeNull();
  });
});
