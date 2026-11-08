// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_MODULE, stubConception } from "./test-conception.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R1 (decision 043 L): the window of « Analyser avec Claude » and « Relancer l'analyse », like « Développer avec Claude » (decision 034, DevelopWindow.test.tsx).
//
// Pinned where the decision leaves it open (the developer follows these):
// - The window is the right Panel: role complementary named « Analyser avec Claude », whose heading (same name) takes the focus. Both buttons of the tab open it.
// - It has the text field « Dossier du clone », remembered per project in localStorage under `cockpit.clone.5` (the key of DevelopWindow), prefilled from it.
// - « Ouvrir Claude » is an <a href> when the folder is filled, `claude://code/new?folder=<encoded folder>&q=<encoded "/analyser carte">`; with no folder the same element has no href
//   or aria-disabled="true" (or is a disabled button). Clicking it stores the folder. « Copier le prompt » writes the prompt, exactly `/analyser carte`, to the clipboard and « Copié » is shown.
// - Two checkboxes since R2 (decision 047 L, details in AnalyseRules.test.tsx): « Carte » checked at first, « Règles » not, so the first prompt is `/analyser carte`. « Annuler » closes the window.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const FOLDER = "/home/dorian/code/hello";
const WINDOWS = "C:\\Users\\dorian\\code\\hello";

async function openWindow(button: string, modules: (typeof API_MODULE)[] = []) {
  const api = stubConception({ modules });
  renderAt("/projets/5/conception");
  fireEvent.click(await screen.findByRole("button", { name: button }));
  const panel = await screen.findByRole("complementary", {
    name: "Analyser avec Claude",
  });
  return { api, panel, ui: within(panel) };
}
const folderField = (ui: ReturnType<typeof within>) =>
  ui.getByLabelText("Dossier du clone") as HTMLInputElement;
const openClaude = (panel: HTMLElement) => {
  const el = within(panel).getByText("Ouvrir Claude").closest("a, button");
  if (!el) throw new Error("no « Ouvrir Claude » link or button");
  const disabled =
    el.getAttribute("aria-disabled") === "true" ||
    (el as HTMLButtonElement).disabled === true ||
    (el.tagName === "A" && !el.getAttribute("href"));
  return { el, disabled, href: el.getAttribute("href") };
};
const type = (el: HTMLElement, value: string) =>
  fireEvent.change(el, { target: { value } });

describe("decision 043 L: opening the window", () => {
  it("given no map, when « Analyser avec Claude » is clicked, then the window opens with a heading of the same name and the field « Dossier du clone »", async () => {
    const { panel, ui } = await openWindow("Analyser avec Claude");

    expect(
      within(panel).getByRole("heading", { name: "Analyser avec Claude" }),
    ).toBeDefined();
    expect(folderField(ui).value).toBe("");
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Analyser avec Claude"),
    );
  });

  it("given a map, when « Relancer l'analyse » is clicked, then the same window opens", async () => {
    const { ui } = await openWindow("Relancer l'analyse", [API_MODULE]);

    expect(folderField(ui)).toBeDefined();
    expect(ui.getByText("Ouvrir Claude")).toBeDefined();
  });

  it("given the window, when « Annuler » is clicked, then it closes", async () => {
    const { ui } = await openWindow("Analyser avec Claude");

    fireEvent.click(ui.getByRole("button", { name: "Annuler" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Analyser avec Claude" }),
      ).toBeNull(),
    );
  });

  it("given the window, when it is shown, then it has five checkboxes, « Carte » checked and the others not (decisions 047 L and 051 J)", async () => {
    const { panel } = await openWindow("Analyser avec Claude");

    const boxes = within(panel).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => [b.labels?.[0]?.textContent, b.checked])).toEqual([
      ["Carte", true],
      ["Règles", false],
      ["Bugs", false],
      ["Sécurité", false],
      ["Architecture et stack", false],
    ]);
  });
});

describe("decision 043 L: the clone folder, remembered per project", () => {
  it("given cockpit.clone.5 in localStorage, when the window opens, then the field is prefilled and « Ouvrir Claude » is a link to the folder with /analyser carte", async () => {
    window.localStorage.setItem("cockpit.clone.5", FOLDER);

    const { panel, ui } = await openWindow("Analyser avec Claude");

    expect(folderField(ui).value).toBe(FOLDER);
    const open = openClaude(panel);
    expect(open.disabled).toBe(false);
    expect(open.href).toBe(
      `claude://code/new?folder=${encodeURIComponent(FOLDER)}&q=${encodeURIComponent("/analyser carte")}`,
    );
  });

  it("given no folder, when the window opens, then « Ouvrir Claude » is not usable until a folder is typed; a Windows path is encoded in the link", async () => {
    const { panel, ui } = await openWindow("Analyser avec Claude");
    expect(openClaude(panel).disabled).toBe(true);

    type(folderField(ui), WINDOWS);

    const open = openClaude(panel);
    expect(open.disabled).toBe(false);
    expect(open.href).toBe(
      `claude://code/new?folder=${encodeURIComponent(WINDOWS)}&q=${encodeURIComponent("/analyser carte")}`,
    );
  });

  it("given a typed folder, when « Ouvrir Claude » is clicked, then the folder is remembered for the project 5", async () => {
    const { panel, ui } = await openWindow("Analyser avec Claude");
    type(folderField(ui), FOLDER);

    fireEvent.click(openClaude(panel).el);

    expect(window.localStorage.getItem("cockpit.clone.5")).toBe(FOLDER);
  });
});

describe("decision 043 L: « Copier le prompt »", () => {
  it("given the window, when « Copier le prompt » is clicked, then /analyser carte is written to the clipboard and « Copié » is shown", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { ui } = await openWindow("Analyser avec Claude");

    fireEvent.click(ui.getByRole("button", { name: "Copier le prompt" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("/analyser carte"),
    );
    expect(await ui.findByText("Copié")).toBeDefined();
  });
});
