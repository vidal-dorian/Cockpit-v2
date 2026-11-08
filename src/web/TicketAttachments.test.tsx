// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeFile, fileOf, layerFiles } from "./test-attachments.tsx";
import { renderAt, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 11.4, decision 061 E and J (S21): the card « Pièces jointes » of the ticket page.
//
// Pinned choices (the decision leaves them open):
// - The card is a <section> named « Pièces jointes » (role region, an <h2> of that name) on /tickets/:id, always there (also without attachment, so that one can be added).
//   It reads GET /api/tickets/:id/attachments -> { attachments: [{ id, name, mediaType, size, createdAt }] }.
// - One <li> per file, in the order given: an icon (🖼 image, 📄 PDF, 📝 text), the name as a link (<a href="/api/attachments/:id">) and the size in words:
//   under 1 Ko « 500 o »; under 1 Mo whole kibibytes « 84 Ko » (86 016 bytes), « 2 Ko » (2 048); from 1 Mo one decimal with a comma, a « ,0 » dropped: « 1,2 Mo » (1 258 291 bytes), « 5 Mo ».
// - Each li has a button « Retirer » (its accessible name is « Retirer <name> »). A click shows « Confirmer le retrait » and « Annuler » in that li (the « Retirer » button is gone) and sends nothing;
//   « Annuler » goes back; « Confirmer le retrait » sends DELETE /api/attachments/:id, then the card reads the list again and the file is gone.
// - Under the list: « Claude les lit quand il écrit les US. » and the button « + Ajouter ». The card holds one <input type="file" multiple>; a click on « + Ajouter » clicks it.
// - Choosing files POSTs each to /api/tickets/:id/attachments, one after the other, in the order chosen, as multipart with the field `file`. While it works the card shows « Envoi… »; then the list shows the new files.
// - A refusal (400 { error }) shows in a role="alert" the name of the file and a sentence by code:
//   unsupported_type « Ce type de fichier n'est pas accepté : images, PDF ou texte. »; too_large « Ce fichier dépasse 20 Mo (3,75 Mo pour une image). »;
//   too_many « Ce ticket a déjà 20 pièces jointes. »; invalid_name « Ce nom de fichier n'est pas valide. » (061 does not word it). The other files of the choice are still sent.
// - Archived project (GET /api/projects says `archived`): the card only reads: the files and their links, no « + Ajouter », no « Retirer ».
// - J: an attachment is never HTML in the page: a name that looks like markup stays text, nothing is embedded (no iframe, embed, object), and a PDF or a text has no <img>.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

const MO = 1024 * 1024;
const SENTENCES = {
  unsupported_type:
    "Ce type de fichier n'est pas accepté : images, PDF ou texte.",
  too_large: "Ce fichier dépasse 20 Mo (3,75 Mo pour une image).",
  too_many: "Ce ticket a déjà 20 pièces jointes.",
  invalid_name: "Ce nom de fichier n'est pas valide.",
};
const FILES = [
  fakeFile(21, "maquette-email.png", "image/png", 86_016),
  fakeFile(22, "retours-support.pdf", "application/pdf", 1_258_291),
  fakeFile(23, "exemple.csv", "text/csv", 2_048),
];

const open = async (options: Parameters<typeof layerFiles>[0] = {}) => {
  stubTicketApi([ticket(7, "Ajouter la recherche")]);
  const api = layerFiles(options);
  renderAt("/tickets/7");
  const card = within(
    await screen.findByRole("region", { name: "Pièces jointes" }),
  );
  return { ...api, card };
};
const input = () => {
  const found = screen
    .getByRole("region", { name: "Pièces jointes" })
    .querySelectorAll<HTMLInputElement>('input[type="file"]');
  expect(found).toHaveLength(1);
  return found[0] as HTMLInputElement;
};
const choose = (...files: File[]) =>
  fireEvent.change(input(), { target: { files } });
const itemOf = (name: string) =>
  screen.getByRole("link", { name }).closest("li") as HTMLElement;

describe("061 E: reading the card", () => {
  it("given three attachments, when the ticket page loads, then the card lists them with icon, name as a download link and size in words", async () => {
    const { card } = await open({ files: { 7: FILES } });

    expect(
      card.getByRole("heading", { level: 2, name: "Pièces jointes" }),
    ).toBeDefined();
    const items = await card.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("🖼");
    expect(items[0]?.textContent).toContain("84 Ko");
    expect(items[1]?.textContent).toContain("📄");
    expect(items[1]?.textContent).toContain("1,2 Mo");
    expect(items[2]?.textContent).toContain("📝");
    expect(items[2]?.textContent).toContain("2 Ko");
    for (const file of FILES) {
      const link = card.getByRole("link", { name: file.name });
      expect(link.getAttribute("href")).toBe(`/api/attachments/${file.id}`);
    }
    expect(
      card.getByText("Claude les lit quand il écrit les US."),
    ).toBeDefined();
    expect(card.getByRole("button", { name: "+ Ajouter" })).toBeDefined();
  });

  it.each([
    [500, "500 o"],
    [2_048, "2 Ko"],
    [86_016, "84 Ko"],
    [1_258_291, "1,2 Mo"],
    [5 * MO, "5 Mo"],
    [20 * MO, "20 Mo"],
  ])(
    "given a file of %i bytes, when the card is read, then its size is written « %s »",
    async (size, words) => {
      const { card } = await open({
        files: { 7: [fakeFile(21, "a.txt", "text/plain", size)] },
      });

      const item = (await card.findByRole("link", { name: "a.txt" })).closest(
        "li",
      );

      expect(item?.textContent).toContain(words);
    },
  );

  it("given a ticket without attachment, when the page loads, then the card is there with the sentence and « + Ajouter » and no item", async () => {
    const { card } = await open();

    expect(
      card.getByText("Claude les lit quand il écrit les US."),
    ).toBeDefined();
    expect(card.getByRole("button", { name: "+ Ajouter" })).toBeDefined();
    expect(card.queryAllByRole("listitem")).toEqual([]);
  });

  it("given an archived project, when the page loads, then the card only reads: the files are links, no « + Ajouter », no « Retirer »", async () => {
    const { card } = await open({ files: { 7: FILES }, archived: true });

    await card.findByRole("link", { name: "exemple.csv" });

    expect(card.queryByRole("button", { name: "+ Ajouter" })).toBeNull();
    expect(card.queryByRole("button", { name: /^Retirer/ })).toBeNull();
    expect(
      screen
        .getByRole("region", { name: "Pièces jointes" })
        .querySelector('input[type="file"]'),
    ).toBeNull();
  });
});

describe("061 E: removing a file", () => {
  it("given a file, when « Retirer » is clicked, then the confirmation shows on the spot and nothing is sent; « Annuler » goes back", async () => {
    const { card, deletes } = await open({ files: { 7: FILES } });
    await card.findByRole("link", { name: "exemple.csv" });

    fireEvent.click(card.getByRole("button", { name: "Retirer exemple.csv" }));

    const item = within(itemOf("exemple.csv"));
    expect(
      item.getByRole("button", { name: "Confirmer le retrait" }),
    ).toBeDefined();
    expect(item.queryByRole("button", { name: /^Retirer/ })).toBeNull();
    expect(deletes).toEqual([]);
    fireEvent.click(item.getByRole("button", { name: "Annuler" }));
    expect(
      within(itemOf("exemple.csv")).getByRole("button", {
        name: "Retirer exemple.csv",
      }),
    ).toBeDefined();
    expect(deletes).toEqual([]);
  });

  it("given the confirmation, when « Confirmer le retrait » is clicked, then DELETE /api/attachments/:id is sent and the file leaves the card", async () => {
    const { card, deletes } = await open({ files: { 7: FILES } });
    await card.findByRole("link", { name: "exemple.csv" });
    fireEvent.click(card.getByRole("button", { name: "Retirer exemple.csv" }));

    fireEvent.click(
      within(itemOf("exemple.csv")).getByRole("button", {
        name: "Confirmer le retrait",
      }),
    );

    await waitFor(() =>
      expect(card.queryByRole("link", { name: "exemple.csv" })).toBeNull(),
    );
    expect(deletes).toEqual([23]);
    expect(
      card.getByRole("link", { name: "maquette-email.png" }),
    ).toBeDefined();
  });
});

describe("061 E: adding files", () => {
  it("given the card, when « + Ajouter » is clicked, then it opens the file picker of a multiple input", async () => {
    const { card } = await open();
    const click = vi.spyOn(HTMLInputElement.prototype, "click");

    fireEvent.click(card.getByRole("button", { name: "+ Ajouter" }));

    expect(input().multiple).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toBe(input());
  });

  it("given two files chosen, when they are sent, then « Envoi… » shows meanwhile, each is POSTed in order as the field file, and both end in the list", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { card, uploads } = await open({ hold });

    choose(fileOf("un.txt", 5), fileOf("deux.csv", 7));

    expect(await card.findByText("Envoi…")).toBeDefined();
    release();
    await card.findByRole("link", { name: "deux.csv" });
    expect(card.getByRole("link", { name: "un.txt" })).toBeDefined();
    expect(uploads).toEqual([
      { ticketId: 7, name: "un.txt", size: 5, field: "file" },
      { ticketId: 7, name: "deux.csv", size: 7, field: "file" },
    ]);
    expect(card.queryByText("Envoi…")).toBeNull();
  });

  it.each(Object.entries(SENTENCES))(
    "given the server refuses a file with %s, when it is sent, then an alert gives the file name and « %s »",
    async (code, sentence) => {
      const { card } = await open({ refuse: () => code });

      choose(fileOf("plan.png", 5));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("plan.png");
      expect(alert.textContent).toContain(sentence);
      expect(card.queryByRole("link", { name: "plan.png" })).toBeNull();
      expect(card.queryByText("Envoi…")).toBeNull();
    },
  );

  it("given three files of which the first is refused, when they are sent, then the other two are still sent and listed, and the alert names the first", async () => {
    const { card, uploads } = await open({
      refuse: ({ name }) => (name === "gros.pdf" ? "too_large" : undefined),
    });

    choose(fileOf("gros.pdf", 5), fileOf("a.txt", 5), fileOf("b.txt", 5));

    await card.findByRole("link", { name: "b.txt" });
    expect(card.getByRole("link", { name: "a.txt" })).toBeDefined();
    expect(uploads.map((u) => u.name)).toEqual(["gros.pdf", "a.txt", "b.txt"]);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("gros.pdf");
    expect(alert.textContent).toContain(SENTENCES.too_large);
    expect(alert.textContent).not.toContain("a.txt");
  });
});

describe("061 E (review): the projects list, read to know whether the project is archived", () => {
  it("given GET /api/projects still pending, when the page loads, then it says « Chargement… » and offers no « + Ajouter » yet", async () => {
    stubTicketApi([ticket(7, "Ajouter la recherche")]);
    layerFiles({ projects: "pending" });
    renderAt("/tickets/7");

    // Long enough for the ticket itself to have been read: only the projects list is still awaited.
    await waitFor(() =>
      expect(
        vi
          .mocked(globalThis.fetch)
          .mock.calls.some(([input]) =>
            String(input).includes("/api/tickets/7"),
          ),
      ).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      within(screen.getByRole("main")).getByText("Chargement…"),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "+ Ajouter" })).toBeNull();
  });

  it("given GET /api/projects failing, when the page loads, then the ticket and its card show, editable, without waiting", async () => {
    stubTicketApi([ticket(7, "Ajouter la recherche")]);
    layerFiles({ projects: 500, files: { 7: FILES } });
    renderAt("/tickets/7");

    const card = within(
      await screen.findByRole("region", { name: "Pièces jointes" }),
    );
    expect(card.getByRole("button", { name: "+ Ajouter" })).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 1, name: /Ajouter la recherche/ }),
    ).toBeDefined();
  });
});

describe("061 J: never HTML", () => {
  it("given a name that looks like markup, when the card is read, then it is text: no element is created from it", async () => {
    const evil = "<img src=x onerror=alert(1)>.txt";
    const { card } = await open({
      files: { 7: [fakeFile(31, evil, "text/plain", 3)] },
    });

    const link = await card.findByRole("link", { name: evil });

    expect(link.textContent).toBe(evil);
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(link.querySelector("*")).toBeNull();
  });

  it("given a PDF, a text and an image, when the card is read, then nothing is embedded, the PDF and the text have no <img>, and any <img> points at the file", async () => {
    const { card } = await open({ files: { 7: FILES } });
    await card.findByRole("link", { name: "exemple.csv" });
    const region = screen.getByRole("region", { name: "Pièces jointes" });

    expect(region.querySelector("iframe, embed, object, [srcdoc]")).toBeNull();
    expect(itemOf("retours-support.pdf").querySelector("img")).toBeNull();
    expect(itemOf("exemple.csv").querySelector("img")).toBeNull();
    for (const img of region.querySelectorAll("img"))
      expect(img.getAttribute("src")).toBe("/api/attachments/21");
  });
});
