// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT,
  COMMIT,
  plan,
  SKILL,
  stubConception,
} from "./test-conception.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R2 (decision 047 L and M): the cases of the window « Analyser avec Claude », and its offer of the three files of /analyser.
//
// Pinned where the decision leaves it open (the developer follows these):
// - Two checkboxes, « Carte » (checked at first) and « Règles » (not checked at first), in the window. When « Règles » is checked the text field
//   « Fonctionnalités à reprendre » is there, `required`, and « Ouvrir Claude » is not usable while it is blank (or only spaces). With no case checked it is not usable either.
// - The prompt is `/analyser carte`, `/analyser regles <features>` or `/analyser carte regles <features>` (both, the map first), the features being the field as typed, trimmed
//   (« Connexion, Facturation »). « Ouvrir Claude » is `claude://code/new?folder=<folder>&q=<encoded prompt>` and « Copier le prompt » writes the same prompt.
// - The plan of « Ajouter /analyser au repo » now has three files: the skill, the cartographer and `.claude/agents/rules-analyst.md`; all three are listed and sent.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const FOLDER = "/home/dorian/code/hello";
const RULES_AGENT = ".claude/agents/rules-analyst.md";

async function openWindow(options: Parameters<typeof stubConception>[0] = {}) {
  const api = stubConception(options);
  window.localStorage.setItem("cockpit.clone.5", FOLDER);
  renderAt("/projets/5/conception");
  fireEvent.click(
    await screen.findByRole("button", { name: "Analyser avec Claude" }),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Analyser avec Claude",
  });
  return { api, panel, ui: within(panel) };
}
const box = (ui: ReturnType<typeof within>, name: string) =>
  ui.getByRole("checkbox", { name }) as HTMLInputElement;
const features = (ui: ReturnType<typeof within>) =>
  ui.getByLabelText("Fonctionnalités à reprendre") as HTMLInputElement;
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
const type = (el: HTMLElement, value: string) =>
  fireEvent.change(el, { target: { value } });

describe("decision 047 L: the cases of the window", () => {
  it("given the window, when it opens, then « Carte » is checked, « Règles » is not, and « Ouvrir Claude » opens /analyser carte", async () => {
    const { panel, ui } = await openWindow();

    expect(box(ui, "Carte").checked).toBe(true);
    expect(box(ui, "Règles").checked).toBe(false);
    expect(openClaude(panel)).toEqual({
      disabled: false,
      href: link("/analyser carte"),
    });
  });

  it("given « Règles » checked, when the window shows, then the field « Fonctionnalités à reprendre » is required and « Ouvrir Claude » is not usable while it is blank", async () => {
    const { panel, ui } = await openWindow();

    fireEvent.click(box(ui, "Règles"));

    expect(features(ui).required).toBe(true);
    expect(openClaude(panel).disabled).toBe(true);
    type(features(ui), "   ");
    expect(openClaude(panel).disabled).toBe(true);
  });

  it("given « Carte » unchecked and « Règles » checked with « Connexion, Facturation », when « Ouvrir Claude » is read, then the prompt is /analyser regles Connexion, Facturation", async () => {
    const { panel, ui } = await openWindow();
    fireEvent.click(box(ui, "Règles"));
    fireEvent.click(box(ui, "Carte"));

    type(features(ui), "  Connexion, Facturation ");

    expect(openClaude(panel)).toEqual({
      disabled: false,
      href: link("/analyser regles Connexion, Facturation"),
    });
  });

  it("given both cases and the features, when « Ouvrir Claude » is read, then the prompt is /analyser carte regles Connexion, Facturation", async () => {
    const { panel, ui } = await openWindow();
    fireEvent.click(box(ui, "Règles"));

    type(features(ui), "Connexion, Facturation");

    expect(openClaude(panel).href).toBe(
      link("/analyser carte regles Connexion, Facturation"),
    );
  });

  it("given no case checked, when the window shows, then « Ouvrir Claude » is not usable", async () => {
    const { panel, ui } = await openWindow();

    fireEvent.click(box(ui, "Carte"));

    expect(openClaude(panel).disabled).toBe(true);
  });

  it("given the two cases and features, when « Copier le prompt » is clicked, then the same prompt is written to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { ui } = await openWindow();
    fireEvent.click(box(ui, "Règles"));
    type(features(ui), "Connexion");

    fireEvent.click(ui.getByRole("button", { name: "Copier le prompt" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "/analyser carte regles Connexion",
      ),
    );
  });
});

describe("decision 047 M: « Ajouter /analyser au repo » offers the three files", () => {
  const prepare = {
    status: 200,
    body: {
      plan: plan([
        { path: SKILL, content: "TEXTE-DU-SKILL", status: "create" },
        { path: AGENT, content: "TEXTE-DE-L-AGENT", status: "create" },
        {
          path: RULES_AGENT,
          content: "TEXTE-DE-RULES-ANALYST",
          status: "create",
        },
      ]),
    },
  };

  it("given a plan of the three files, when the window opens, then the three are listed and « Ajouter /analyser au repo » sends the plan reduced to the three", async () => {
    const { api, panel, ui } = await openWindow({
      prepare,
      apply: {
        status: 200,
        body: { commitSha: COMMIT, created: [SKILL, AGENT, RULES_AGENT] },
      },
    });

    fireEvent.click(
      await ui.findByRole("button", { name: "Ajouter /analyser au repo" }),
    );

    await waitFor(() => expect(panel.textContent).toContain("C'est fait"));
    const items = within(panel)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    for (const path of [SKILL, AGENT, RULES_AGENT])
      expect(
        items.some((t) => t.includes(path)),
        path,
      ).toBe(true);
    const [sent] = api.posts("/api/projects/5/prepare/apply");
    const body = sent?.body as { plan: { files: { path: string }[] } };
    const files = body.plan.files;
    expect(files.map((f) => f.path).sort()).toEqual(
      [AGENT, RULES_AGENT, SKILL].sort(),
    );
  });

  it("given a repo that has the skill and the cartographer but not rules-analyst, when the window opens, then the button is still offered for the missing agent", async () => {
    const { panel, ui } = await openWindow({
      prepare: {
        status: 200,
        body: {
          plan: plan([
            { path: SKILL, content: "x", status: "same" },
            { path: AGENT, content: "x", status: "same" },
            {
              path: RULES_AGENT,
              content: "TEXTE-DE-RULES-ANALYST",
              status: "create",
            },
          ]),
        },
      },
    });

    expect(
      await ui.findByRole("button", { name: "Ajouter /analyser au repo" }),
    ).toBeDefined();
    const item = within(panel)
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes(RULES_AGENT));
    expect(item?.textContent).toContain("Sera ajouté");
  });
});
