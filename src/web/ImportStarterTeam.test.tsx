// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Decision 072 A (modifies 063 D): the level of the starter team is chosen in a carousel dialog opened by « Importer », not above the list.
//
// Pinned where the story leaves it open:
// - « Importer » on a repo opens a modal <dialog> (showModal) named « Quelle équipe pour <owner/name> ? ». Nothing is sent until « Importer avec <Niveau> ».
// - The dots under the carousel are buttons whose accessible name is exactly the level name (the side cards are other buttons, with longer names); the only element of the dialog with aria-current="true" is the current dot.
// - The previous and next levels are buttons « Équipe précédente » / « Équipe suivante » (disabled at the ends); the Left/Right keys are read on the carousel (here: keydown on the next button, which bubbles).
// - A side card is a button whose name contains the level name and is not the dot nor « Importer avec ... ».
// - The agents of a card read « test-writer · haiku → developer · sonnet »; the consumption line reads « Consommation : faible » (Éco), « moyenne », « élevée », « très élevée ».
// - Closing (« Annuler », Escape = the native cancel then close events) unmounts or closes the dialog and gives the focus back to the « Importer » button.
// - The POST /api/projects body is { githubRepoId, starterTeam } with the id of the level (eco, standard, premium, max).

// jsdom has no showModal/close on <dialog>: stub them and restore the originals.
const realShowModal = HTMLDialogElement.prototype.showModal;
const realClose = HTMLDialogElement.prototype.close;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  // jsdom 29 has neither: delete the stub instead of assigning undefined.
  if (realShowModal) HTMLDialogElement.prototype.showModal = realShowModal;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (realClose) HTMLDialogElement.prototype.close = realClose;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const LEVELS = [
  {
    id: "eco",
    name: "Éco",
    sentence: "Le moins cher : pas de relecture.",
    agents: "test-writer · haiku → developer · sonnet",
    use: "Consommation : faible",
  },
  {
    id: "standard",
    name: "Standard",
    sentence: "L'équipe de base, relue.",
    agents: "test-writer · sonnet → developer · sonnet → reviewer · opus",
    use: "Consommation : moyenne",
  },
  {
    id: "premium",
    name: "Premium",
    sentence: "L'équipe de base, et la doc tenue à jour.",
    agents:
      "test-writer · sonnet → developer · sonnet → reviewer · opus → doc-writer · sonnet → doc-reviewer · sonnet",
    use: "Consommation : élevée",
  },
  {
    id: "max",
    name: "Max",
    sentence: "Tout au plus puissant, avec une relecture de sécurité.",
    agents:
      "test-writer · opus → developer · opus → reviewer · opus → security-reviewer · opus → doc-writer · opus → doc-reviewer · opus",
    use: "Consommation : très élevée",
  },
];
const EXPLANATION =
  "Une équipe, c'est les agents qui développent tes US, l'un après l'autre. Plus elle relit, plus elle consomme. Tu pourras la changer ensuite.";

function stubApi(options: { failPost?: boolean } = {}) {
  const posted: unknown[] = [];
  const reads = { projects: 0, repositories: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/projects" && method === "GET") {
        reads.projects++;
        return Response.json({ projects: [] });
      }
      if (path === "/api/github/repositories") {
        reads.repositories++;
        return Response.json({
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
          installed: true,
          repositories: [
            {
              githubRepoId: 10,
              fullName: "octocat/available",
              defaultBranch: "main",
              imported: false,
            },
          ],
        });
      }
      if (path === "/api/projects" && method === "POST") {
        posted.push(JSON.parse(String(init?.body)));
        if (options.failPost)
          return Response.json({ error: "boom" }, { status: 500 });
        return Response.json(
          {
            project: {
              id: 110,
              fullName: "octocat/available",
              defaultBranch: "main",
              archived: false,
            },
          },
          { status: 201 },
        );
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  // Not enumerable: `toEqual` on the posted bodies must not see it.
  return Object.defineProperty(posted, "reads", {
    value: reads,
  }) as typeof posted & { reads: typeof reads };
}

function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}
const importButton = async () =>
  (await screen.findByRole("button", {
    name: "Importer",
  })) as HTMLButtonElement;
const DIALOG = "Quelle équipe pour octocat/available ?";
async function openDialog() {
  const opener = await importButton();
  opener.focus();
  fireEvent.click(opener);
  const dialog = (await screen.findByRole("dialog", {
    name: DIALOG,
  })) as HTMLDialogElement;
  return { dialog, ui: within(dialog), opener };
}
type Ui = ReturnType<typeof within>;
const goTo = (ui: Ui, name: string) =>
  fireEvent.click(ui.getByRole("button", { name }));
const current = (dialog: HTMLElement) =>
  dialog.querySelectorAll('[aria-current="true"]');
const currentName = (dialog: HTMLElement) => {
  const found = current(dialog);
  expect(found).toHaveLength(1);
  return found[0]?.textContent?.trim();
};
const importWith = (ui: Ui, name: string) =>
  ui.getByRole("button", { name: `Importer avec ${name}` });

describe("decision 072 A: the choice of the team after « Importer »", () => {
  it("given the import screen, when it loads, then there is no level choice above the list and the repo has its « Importer » button", async () => {
    stubApi();
    renderAt("/projets");

    await importButton();

    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Quelle équipe pour ce projet ?")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("given the import screen, when « Importer » is clicked, then a modal dialog named after the repo opens with the explanation and nothing is sent", async () => {
    const posted = stubApi();
    renderAt("/projets");

    const { dialog, ui } = await openDialog();

    expect(ui.getByText(EXPLANATION)).toBeDefined();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(posted).toEqual([]);
  });

  it("given the dialog, when it opens, then the carousel starts on Standard, with one dot per level in order and only the current one aria-current", async () => {
    stubApi();
    renderAt("/projets");

    const { dialog, ui } = await openDialog();

    for (const level of LEVELS)
      expect(ui.getByRole("button", { name: level.name })).toBeDefined();
    const dots = LEVELS.map((l) => ui.getByRole("button", { name: l.name }));
    expect(
      dots.every(
        (d, i) =>
          i === 0 ||
          (dots[i - 1] as HTMLElement).compareDocumentPosition(d) &
            Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(currentName(dialog)).toBe("Standard");
    expect(importWith(ui, "Standard")).toBeDefined();
  });

  it.each(LEVELS)(
    "given the level $name current, when the card is shown, then it has its name, sentence, agents with models and consumption",
    async (level) => {
      stubApi();
      renderAt("/projets");
      const { ui } = await openDialog();

      if (level.id !== "standard") goTo(ui, level.name);

      expect(ui.getAllByText(level.sentence).length).toBeGreaterThan(0);
      expect(ui.getAllByText(level.agents).length).toBeGreaterThan(0);
      expect(ui.getAllByText(level.use).length).toBeGreaterThan(0);
      expect(importWith(ui, level.name)).toBeDefined();
    },
  );

  it("given Standard, when « Équipe suivante » and « Équipe précédente » are clicked, then the current level moves and the buttons are disabled at the ends", async () => {
    stubApi();
    renderAt("/projets");
    const { dialog, ui } = await openDialog();
    const next = () =>
      ui.getByRole("button", { name: "Équipe suivante" }) as HTMLButtonElement;
    const previous = () =>
      ui.getByRole("button", {
        name: "Équipe précédente",
      }) as HTMLButtonElement;

    fireEvent.click(next());
    expect(currentName(dialog)).toBe("Premium");
    fireEvent.click(next());
    expect(currentName(dialog)).toBe("Max");
    expect(next().disabled).toBe(true);
    expect(previous().disabled).toBe(false);
    fireEvent.click(previous());
    fireEvent.click(previous());
    fireEvent.click(previous());
    expect(currentName(dialog)).toBe("Éco");
    expect(previous().disabled).toBe(true);
  });

  it("given the carousel, when the Right and Left arrow keys are pressed in it, then the current level moves", async () => {
    stubApi();
    renderAt("/projets");
    const { dialog, ui } = await openDialog();
    const inside = ui.getByRole("button", { name: "Équipe suivante" });

    fireEvent.keyDown(inside, { key: "ArrowRight" });
    expect(currentName(dialog)).toBe("Premium");
    fireEvent.keyDown(inside, { key: "ArrowLeft" });
    fireEvent.keyDown(inside, { key: "ArrowLeft" });
    expect(currentName(dialog)).toBe("Éco");
  });

  it("given the carousel, when « Équipe suivante » is pressed until Max, then the focus stays in the carousel and the keys still work", async () => {
    stubApi();
    renderAt("/projets");
    const { dialog, ui } = await openDialog();
    const next = ui.getByRole("button", { name: "Équipe suivante" });
    next.focus();

    fireEvent.keyDown(next, { key: "ArrowRight" });
    fireEvent.keyDown(next, { key: "ArrowRight" });

    expect(currentName(dialog)).toBe("Max");
    const focused = document.activeElement as HTMLElement;
    expect(focused).not.toBe(document.body);
    expect(dialog.contains(focused)).toBe(true);
    fireEvent.keyDown(focused, { key: "ArrowLeft" });
    expect(currentName(dialog)).toBe("Premium");
  });

  it("given the carousel, when a dot is clicked, then that level becomes current", async () => {
    stubApi();
    renderAt("/projets");
    const { dialog, ui } = await openDialog();

    goTo(ui, "Max");

    expect(currentName(dialog)).toBe("Max");
    expect(importWith(ui, "Max")).toBeDefined();
  });

  it("given Standard current, when the card of the next level beside it is clicked, then Premium becomes current", async () => {
    stubApi();
    renderAt("/projets");
    const { dialog, ui } = await openDialog();
    const side = ui
      .getAllByRole("button", { name: /Premium/ })
      .filter(
        (b) =>
          b.textContent?.trim() !== "Premium" &&
          !/^Importer avec/.test(b.textContent ?? ""),
      );
    expect(side).toHaveLength(1);

    fireEvent.click(side[0] as HTMLElement);

    expect(currentName(dialog)).toBe("Premium");
  });

  it("given the dialog on Standard, when « Importer avec Standard » is clicked, then the POST carries starterTeam standard, the dialog closes and the lists are read again", async () => {
    const posted = stubApi();
    renderAt("/projets");
    const { ui } = await openDialog();
    const before = { ...posted.reads };

    fireEvent.click(importWith(ui, "Standard"));

    await waitFor(() =>
      expect(posted).toEqual([{ githubRepoId: 10, starterTeam: "standard" }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => {
      expect(posted.reads.projects).toBeGreaterThan(before.projects);
      expect(posted.reads.repositories).toBeGreaterThan(before.repositories);
    });
  });

  it.each(LEVELS.filter((l) => l.id !== "standard"))(
    "given the level $name chosen, when « Importer avec $name » is clicked, then the POST carries starterTeam $id",
    async ({ id, name }) => {
      const posted = stubApi();
      renderAt("/projets");
      const { ui } = await openDialog();
      goTo(ui, name);

      fireEvent.click(importWith(ui, name));

      await waitFor(() =>
        expect(posted).toEqual([{ githubRepoId: 10, starterTeam: id }]),
      );
    },
  );

  it("given a failing server, when « Importer avec Standard » is clicked, then the error is an alert in the dialog, which stays open", async () => {
    stubApi({ failPost: true });
    renderAt("/projets");
    const { dialog, ui } = await openDialog();

    fireEvent.click(importWith(ui, "Standard"));

    expect(await ui.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("dialog", { name: DIALOG })).toBe(dialog);
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("given the dialog, when « Annuler » is clicked, then it closes, nothing is sent and the focus is back on « Importer »", async () => {
    const posted = stubApi();
    renderAt("/projets");
    const { ui, opener } = await openDialog();

    fireEvent.click(ui.getByRole("button", { name: "Annuler" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posted).toEqual([]);
    expect(document.activeElement).toBe(opener);
  });

  it("given the dialog, when Escape closes it, then nothing is sent and the focus is back on « Importer »", async () => {
    const posted = stubApi();
    renderAt("/projets");
    const { dialog, opener } = await openDialog();

    // What the browser does on Escape: cancel, then close.
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posted).toEqual([]);
    expect(document.activeElement).toBe(opener);
  });
});
