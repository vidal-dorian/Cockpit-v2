// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileOf, layerFiles } from "./test-attachments.tsx";
import { renderAt } from "./test-tickets.tsx";
import { stubBar } from "./test-tickets-full.tsx";

// Slice 11.4, decision 061 F (S09): « + Pièce jointe » in the panel of the idea.
//
// Pinned choices (the decision leaves them open):
// - The panel (role dialog « Noter une idée ») gets a button « + Pièce jointe » and holds one <input type="file" multiple>; the button clicks it.
// - A chosen file becomes a chip: the text « <name> · <size> » (sizes written as on the ticket page: « 2 Ko » for 2 048 bytes) and a button « Retirer <name> » (a cross) that takes it out of the draft.
// - The type and the size are checked as soon as the file is chosen, on the name's extension (png, jpg, jpeg, webp, gif: an image, 3,75 Mo at most (3 932 160 bytes); pdf, txt, md, csv, json: 20 Mo at most; a Mo is 1 048 576 bytes)
//   and the size: a file that fails is NOT added as a chip, nothing is sent, and a role="alert" in the panel gives its name and the sentence of the ticket page:
//   « Ce type de fichier n'est pas accepté : images, PDF ou texte. » or « Ce fichier dépasse 20 Mo (3,75 Mo pour une image). ». The server re-checks (the content, the count).
// - « Noter » POSTs the ticket as before, THEN POSTs /api/tickets/:new-id/attachments once per chip, in the order of the chips, as multipart with the field `file`.
//   Without chip, no request on the attachments. All attached: the panel closes and « Idée notée dans <repo>. » shows, as before.
// - A refused upload leaves the ticket created: the panel closes and the bar is emptied as for a success, and a role="alert" says « pas été joint(s) », names each refused file (and none of the attached ones)
//   and holds a link « Ouvrir le ticket » to /tickets/:new-id to try again. The files after a refused one are still sent.
// - « Annuler » keeps the chips in the draft, like the rest of the draft (055 D): the panel opened again shows them.
// - The idea is not sent twice: nothing about the attachments changes the POST of the ticket ({ title, descriptionMd?, priority, tags }).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

const MO = 1024 * 1024;
const IMAGE_MAX = 3_932_160;
const TYPE = "Ce type de fichier n'est pas accepté : images, PDF ou texte.";
const LARGE = "Ce fichier dépasse 20 Mo (3,75 Mo pour une image).";

const open = async (title = "ranger le Kanban") => {
  const bar = within(
    await screen.findByRole("form", { name: "Noter une idée" }),
  );
  const field = bar.getByRole("textbox", { name: "Idée" });
  const form = await screen.findByRole("form", { name: "Noter une idée" });
  fireEvent.change(field, { target: { value: title } });
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.submit(form);
};
const dialog = () => screen.findByRole("dialog", { name: "Noter une idée" });
const inPanel = async () => within(await dialog());
const input = async () => {
  const found = (await dialog()).querySelectorAll<HTMLInputElement>(
    'input[type="file"]',
  );
  expect(found).toHaveLength(1);
  return found[0] as HTMLInputElement;
};
const choose = async (...files: File[]) =>
  fireEvent.change(await input(), { target: { files } });
const noter = async () =>
  (await inPanel()).getByRole("button", { name: /^Noter/ });
const ticketPosts = (api: {
  sent: { method: string; path: string; body: unknown }[];
}) =>
  api.sent.filter(
    (s) =>
      s.method === "POST" && /^\/api\/projects\/\d+\/tickets$/.test(s.path),
  );
const start = (options: Parameters<typeof layerFiles>[0] = {}) => {
  const api = stubBar();
  const files = layerFiles(options);
  renderAt("/");
  return { ...api, ...files };
};

describe("061 F: choosing files", () => {
  it("given the panel, when it opens, then it has « + Pièce jointe » and a multiple file input, and the button opens the picker", async () => {
    start();
    await open();
    const click = vi.spyOn(HTMLInputElement.prototype, "click");

    fireEvent.click(
      (await inPanel()).getByRole("button", { name: "+ Pièce jointe" }),
    );

    expect((await input()).multiple).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toBe(await input());
  });

  it("given files chosen, when the panel is read, then each is a chip « name · size » with a cross, and nothing is sent", async () => {
    const api = start();
    await open();

    await choose(fileOf("exemple.csv", 2_048), fileOf("plan.png", 3 * MO));

    const panel = await inPanel();
    expect(panel.getByText("exemple.csv · 2 Ko")).toBeDefined();
    expect(panel.getByText("plan.png · 3 Mo")).toBeDefined();
    expect(
      panel.getByRole("button", { name: "Retirer exemple.csv" }),
    ).toBeDefined();
    expect(api.uploads).toEqual([]);
    expect(ticketPosts(api)).toEqual([]);
  });

  it("given a chip, when its cross is clicked, then the file leaves the draft and is not sent", async () => {
    const api = start();
    await open();
    await choose(fileOf("a.txt", 5), fileOf("b.txt", 5));

    fireEvent.click(
      (await inPanel()).getByRole("button", { name: "Retirer a.txt" }),
    );
    fireEvent.click(await noter());

    await waitFor(() =>
      expect(api.uploads.map((u) => u.name)).toEqual(["b.txt"]),
    );
  });

  it.each([
    ["a type that is not accepted", "outil.exe", 10, TYPE],
    ["an SVG", "logo.svg", 10, TYPE],
    ["an image over 3,75 Mo", "grande.png", IMAGE_MAX + 1, LARGE],
    ["a PDF over 20 Mo", "énorme.pdf", 20 * MO + 1, LARGE],
    ["a text over 20 Mo", "journal.txt", 20 * MO + 1, LARGE],
  ])(
    "given %s, when it is chosen, then no chip, nothing sent, and an alert gives its name and the sentence",
    async (_what, name, size, sentence) => {
      const api = start();
      await open();

      await choose(fileOf(name, size));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(name);
      expect(alert.textContent).toContain(sentence);
      expect(
        (await inPanel()).queryByRole("button", { name: `Retirer ${name}` }),
      ).toBeNull();
      expect(api.uploads).toEqual([]);
      expect(ticketPosts(api)).toEqual([]);
    },
  );

  it("given an image of exactly 3,75 Mo and a PDF of exactly 20 Mo, when they are chosen, then both are chips", async () => {
    start();
    await open();

    await choose(
      fileOf("limite.png", IMAGE_MAX),
      fileOf("limite.pdf", 20 * MO),
    );

    const panel = await inPanel();
    expect(
      panel.getByRole("button", { name: "Retirer limite.png" }),
    ).toBeDefined();
    expect(panel.getByText("limite.pdf · 20 Mo")).toBeDefined();
  });

  it("given a good and a bad file chosen together, when the choice is made, then the good one is a chip and the bad one is named in the alert", async () => {
    start();
    await open();

    await choose(fileOf("bon.md", 5), fileOf("mauvais.zip", 5));

    expect((await inPanel()).getByText("bon.md · 5 o")).toBeDefined();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "mauvais.zip",
    );
  });
});

describe("061 F: Noter", () => {
  it("given two chips, when « Noter » is clicked, then the ticket is created, then each file is POSTed to the new ticket in order as the field file, the panel closes and the idea is said noted", async () => {
    const api = start();
    await open("Exporter");
    await choose(fileOf("exemple.csv", 2_048), fileOf("plan.png", 100));

    fireEvent.click(await noter());

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ticketPosts(api)).toHaveLength(1);
    expect(ticketPosts(api)[0]?.body).toEqual({
      title: "Exporter",
      priority: "normal",
      tags: [],
    });
    expect(api.uploads).toEqual([
      { ticketId: 100, name: "exemple.csv", size: 2_048, field: "file" },
      { ticketId: 100, name: "plan.png", size: 100, field: "file" },
    ]);
    expect((await screen.findByRole("status")).textContent).toBe(
      "Idée notée dans hello.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("given no chip, when « Noter » is clicked, then no request goes to the attachments", async () => {
    const api = start();
    await open();
    expect(
      (await inPanel()).getByRole("button", { name: "+ Pièce jointe" }),
    ).toBeDefined();

    fireEvent.click(await noter());

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.uploads).toEqual([]);
  });

  it("given two chips of which the first is refused by the server, when « Noter » is clicked, then the ticket exists, the second is still sent and the alert names the first with a link to the ticket", async () => {
    const api = start({
      refuse: ({ name }) =>
        name === "plan.png" ? "unsupported_type" : undefined,
    });
    await open("Exporter");
    await choose(fileOf("plan.png", 100), fileOf("exemple.csv", 100));

    fireEvent.click(await noter());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/pas été joints?/);
    expect(alert.textContent).toContain("plan.png");
    expect(alert.textContent).not.toContain("exemple.csv");
    const link = within(alert).getByRole("link", { name: "Ouvrir le ticket" });
    expect(link.getAttribute("href")).toBe("/tickets/100");
    expect(api.uploads.map((u) => u.name)).toEqual(["plan.png", "exemple.csv"]);
    expect(ticketPosts(api)).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    const bar = within(screen.getByRole("form", { name: "Noter une idée" }));
    expect(
      (bar.getByRole("textbox", { name: "Idée" }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("given a ticket the server refuses, when « Noter » is clicked with chips, then no file is sent and the panel keeps its chips", async () => {
    const api = stubBar({ ticketStatus: 409 });
    const files = layerFiles();
    renderAt("/");
    await open();
    await choose(fileOf("a.txt", 5));

    fireEvent.click(await noter());

    await screen.findByRole("alert");
    expect(files.uploads).toEqual([]);
    expect(ticketPosts(api)).toHaveLength(1);
    expect((await inPanel()).getByText("a.txt · 5 o")).toBeDefined();
  });
});

describe("061 F: Annuler", () => {
  it("given chips, when « Annuler » is clicked and the panel opened again, then the chips are still in the draft", async () => {
    const api = start();
    await open();
    await choose(fileOf("exemple.csv", 2_048));

    fireEvent.click((await inPanel()).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await open();

    expect((await inPanel()).getByText("exemple.csv · 2 Ko")).toBeDefined();
    expect(api.uploads).toEqual([]);
    expect(ticketPosts(api)).toEqual([]);
  });
});
