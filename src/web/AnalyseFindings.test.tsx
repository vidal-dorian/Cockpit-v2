// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubConception } from "./test-conception.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R5 (decision 051 J): the window « Analyser avec Claude » gains the cases of the findings.
//
// Pinned where the decision leaves it open (the developer follows these):
// - Three checkboxes more, after « Carte » and « Règles »: « Bugs », « Sécurité » and « Architecture et stack », all unchecked at first, so the first prompt stays `/analyser carte`.
// - The prompt words are `bugs`, `securite` and `architecture`, written after `carte` and before the features of `regles` (`/analyser carte bugs securite architecture`); a case needs
//   no field (only « Règles » asks for the features). « Ouvrir Claude » is `claude://code/new?folder=<folder>&q=<encoded prompt>`, « Copier le prompt » writes the same prompt.
// - With none of the five cases checked, « Ouvrir Claude » is not usable.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const FOLDER = "/home/dorian/code/hello";

async function openWindow() {
  stubConception({});
  window.localStorage.setItem("cockpit.clone.5", FOLDER);
  renderAt("/projets/5/conception");
  fireEvent.click(
    await screen.findByRole("button", { name: "Analyser avec Claude" }),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Analyser avec Claude",
  });
  return { panel, ui: within(panel) };
}
const box = (ui: ReturnType<typeof within>, name: string) =>
  ui.getByRole("checkbox", { name }) as HTMLInputElement;
const openClaude = (panel: HTMLElement) => {
  const el = within(panel).getByText("Ouvrir Claude").closest("a, button");
  if (!el) throw new Error("no « Ouvrir Claude » link or button");
  const disabled =
    el.getAttribute("aria-disabled") === "true" ||
    (el as HTMLButtonElement).disabled === true ||
    (el.tagName === "A" && !el.getAttribute("href"));
  return { disabled, href: el.getAttribute("href") };
};
const link = (prompt: string) =>
  `claude://code/new?folder=${encodeURIComponent(FOLDER)}&q=${encodeURIComponent(prompt)}`;

describe("decision 051 J: the cases of the findings in the window", () => {
  it("given the window, when it opens, then « Bugs », « Sécurité » and « Architecture et stack » are there, unchecked, and the prompt is still /analyser carte", async () => {
    const { panel, ui } = await openWindow();

    expect(box(ui, "Bugs").checked).toBe(false);
    expect(box(ui, "Sécurité").checked).toBe(false);
    expect(box(ui, "Architecture et stack").checked).toBe(false);
    expect(box(ui, "Carte").checked).toBe(true);
    expect(openClaude(panel)).toEqual({
      disabled: false,
      href: link("/analyser carte"),
    });
  });

  it.each([
    ["Bugs", "/analyser carte bugs"],
    ["Sécurité", "/analyser carte securite"],
    ["Architecture et stack", "/analyser carte architecture"],
  ])(
    "given « %s » checked next to « Carte », when the window shows, then « Ouvrir Claude » opens %s",
    async (name, prompt) => {
      const { panel, ui } = await openWindow();

      fireEvent.click(box(ui, name));

      expect(openClaude(panel)).toEqual({
        disabled: false,
        href: link(prompt),
      });
    },
  );

  it("given the three cases checked and « Carte » unchecked, when the window shows, then the prompt is /analyser bugs securite architecture and needs no field", async () => {
    const { panel, ui } = await openWindow();

    fireEvent.click(box(ui, "Carte"));
    fireEvent.click(box(ui, "Bugs"));
    fireEvent.click(box(ui, "Sécurité"));
    fireEvent.click(box(ui, "Architecture et stack"));

    expect(openClaude(panel)).toEqual({
      disabled: false,
      href: link("/analyser bugs securite architecture"),
    });
    expect(ui.queryByLabelText("Fonctionnalités à reprendre")).toBeNull();
  });

  it("given the map and a case of the findings, when « Copier le prompt » is clicked, then the same prompt is written to the clipboard", async () => {
    const { ui } = await openWindow();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    fireEvent.click(box(ui, "Sécurité"));

    fireEvent.click(ui.getByRole("button", { name: "Copier le prompt" }));

    expect(writeText).toHaveBeenCalledWith("/analyser carte securite");
  });

  it("given every case unchecked, when the window shows, then « Ouvrir Claude » is not usable", async () => {
    const { panel, ui } = await openWindow();

    expect(box(ui, "Bugs").checked).toBe(false);
    fireEvent.click(box(ui, "Carte"));

    expect(openClaude(panel).disabled).toBe(true);
  });

  it("given « Règles » and a case of the findings, when the window shows, then the prompt holds the three words and the features end it", async () => {
    const { panel, ui } = await openWindow();
    fireEvent.click(box(ui, "Règles"));
    fireEvent.change(ui.getByLabelText("Fonctionnalités à reprendre"), {
      target: { value: "Connexion" },
    });
    fireEvent.click(box(ui, "Bugs"));

    const { href } = openClaude(panel);

    const prompt = decodeURIComponent((href ?? "").split("&q=")[1] ?? "");
    expect(prompt.endsWith(" Connexion")).toBe(true);
    expect(prompt).toMatch(/^\/analyser /);
    expect(prompt.split(" ")).toEqual(
      expect.arrayContaining(["carte", "regles", "bugs"]),
    );
  });
});
