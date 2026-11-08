// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubConception } from "./test-conception.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R6 (decision 052 K): the window « Analyser avec Claude » gains the case « Versions » and its word `versions`.
//
// Pinned where the decision leaves it open (the developer follows these):
// - One checkbox more, « Versions », unchecked at first (so the first prompt stays `/analyser carte`), after « Architecture et stack » in the window.
// - The prompt word is `versions`, written after `architecture` and before `regles` (`/analyser carte bugs securite architecture versions`); the case needs no field.
//   « Ouvrir Claude » is `claude://code/new?folder=<folder>&q=<encoded prompt>`, « Copier le prompt » writes the same prompt.
// - With « Versions » alone checked (« Carte » unchecked) the prompt is `/analyser versions` and « Ouvrir Claude » is usable; with none of the cases checked it is not.

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

describe("decision 052 K: the case « Versions » in the window", () => {
  it("given the window, when it opens, then « Versions » is there, unchecked, after « Architecture et stack », and the prompt is still /analyser carte", async () => {
    const { panel, ui } = await openWindow();

    expect(box(ui, "Versions").checked).toBe(false);
    const boxes = ui
      .getAllByRole("checkbox")
      .map((b) => b.getAttribute("id") ?? "");
    const labels = ui
      .getAllByRole("checkbox")
      .map((b) => (b.closest("label")?.textContent ?? "").trim());
    expect(labels.indexOf("Versions")).toBeGreaterThan(
      labels.indexOf("Architecture et stack"),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(6);
    expect(openClaude(panel)).toEqual({
      disabled: false,
      href: link("/analyser carte"),
    });
  });

  it("given « Versions » checked next to « Carte », when the window shows, then « Ouvrir Claude » opens /analyser carte versions", async () => {
    const { panel, ui } = await openWindow();

    fireEvent.click(box(ui, "Versions"));

    expect(openClaude(panel)).toEqual({
      disabled: false,
      href: link("/analyser carte versions"),
    });
  });

  it("given every case of the findings checked, when the window shows, then the prompt is /analyser carte bugs securite architecture versions", async () => {
    const { panel, ui } = await openWindow();

    for (const name of [
      "Bugs",
      "Sécurité",
      "Architecture et stack",
      "Versions",
    ])
      fireEvent.click(box(ui, name));

    expect(openClaude(panel).href).toBe(
      link("/analyser carte bugs securite architecture versions"),
    );
  });

  it("given « Versions » alone checked, when the window shows, then the prompt is /analyser versions, needs no field and « Ouvrir Claude » is usable", async () => {
    const { panel, ui } = await openWindow();

    fireEvent.click(box(ui, "Carte"));
    fireEvent.click(box(ui, "Versions"));

    expect(openClaude(panel)).toEqual({
      disabled: false,
      href: link("/analyser versions"),
    });
    expect(ui.queryByLabelText("Fonctionnalités à reprendre")).toBeNull();
  });

  it("given « Versions » and « Règles », when the window shows, then the prompt holds both words and the features end it", async () => {
    const { panel, ui } = await openWindow();
    fireEvent.click(box(ui, "Règles"));
    fireEvent.change(ui.getByLabelText("Fonctionnalités à reprendre"), {
      target: { value: "Connexion" },
    });
    fireEvent.click(box(ui, "Versions"));

    const prompt = decodeURIComponent(
      (openClaude(panel).href ?? "").split("&q=")[1] ?? "",
    );

    expect(prompt.endsWith(" Connexion")).toBe(true);
    expect(prompt.split(" ")).toEqual(
      expect.arrayContaining(["carte", "versions", "regles"]),
    );
  });

  it("given « Versions » checked, when « Copier le prompt » is clicked, then the same prompt is written to the clipboard", async () => {
    const { ui } = await openWindow();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    fireEvent.click(box(ui, "Versions"));

    fireEvent.click(ui.getByRole("button", { name: "Copier le prompt" }));

    expect(writeText).toHaveBeenCalledWith("/analyser carte versions");
  });
});
