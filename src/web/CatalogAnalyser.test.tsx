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

// Slice C1 (decision 049 G): « Ajouter /analyser au repo » replaces an old, original copy of an analyser file instead of leaving it as it is.
//
// Pinned where the decision leaves it open (the developer follows these; the server side is in src/server/catalog-update.test.ts):
// - The routes stay those of 027 (POST /api/projects/5/prepare, then /prepare/apply). The plan has a fourth status, `update` (the file of the repo is an old original version),
//   with `current` (the text of the repo) and `content` (the new one). In the window it is a list item with its path, « Sera mis à jour » and the diff of `current` to `content`
//   (« Retirée » / « Ajoutée »); the button « Ajouter /analyser au repo » is offered when at least one file is `create` or `update`, and sends the plan as received, reduced to the analyser files.
// - The same label and diff are in the plan of « Préparer pour Claude » (ProjectPrepare) for such a file; not tested here.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const OLD = "ligne un\nligne deux à l'ancienne";
const NEW = "ligne un\nligne 2 du catalogue";

async function openWindow(prepare: { status: number; body: unknown }) {
  const api = stubConception({ prepare });
  renderAt("/projets/5/conception");
  fireEvent.click(
    await screen.findByRole("button", { name: "Analyser avec Claude" }),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Analyser avec Claude",
  });
  return { api, panel, ui: within(panel) };
}

describe("decision 049 G: an old analyser file is updated", () => {
  it("given an old original analyser skill and a missing agent, when the window opens, then the skill is « Sera mis à jour » with its diff, the agent is « Sera ajouté » and the button is offered", async () => {
    const { panel, ui } = await openWindow({
      status: 200,
      body: {
        plan: plan([
          { path: SKILL, content: NEW, status: "update", current: OLD },
          { path: AGENT, content: "TEXTE-DE-L-AGENT", status: "create" },
        ]),
      },
    });

    await ui.findByRole("button", { name: "Ajouter /analyser au repo" });

    const items = within(panel).getAllByRole("listitem");
    const skill = items.find((li) => li.textContent?.includes(SKILL));
    expect(skill?.textContent).toContain("Sera mis à jour");
    expect(skill?.textContent).toContain("Retirée");
    expect(skill?.textContent).toContain("Ajoutée");
    expect(
      items.find((li) => li.textContent?.includes(AGENT))?.textContent,
    ).toContain("Sera ajouté");
  });

  it("given only an old analyser skill to update, when the window opens, then the button is offered and sends the plan as received, the update status included", async () => {
    const { api, panel, ui } = await openWindow({
      status: 200,
      body: {
        plan: plan([
          { path: SKILL, content: NEW, status: "update", current: OLD },
        ]),
      },
    });

    fireEvent.click(
      await ui.findByRole("button", { name: "Ajouter /analyser au repo" }),
    );

    await waitFor(() => expect(panel.textContent).toContain("C'est fait"));
    const sent = api.posts("/api/projects/5/prepare/apply");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({
      plan: {
        baseSha: "d".repeat(40),
        signature: "signed-by-the-server",
        files: [{ path: SKILL, content: NEW, status: "update", current: OLD }],
      },
    });
    expect(
      within(panel)
        .getByRole("link", { name: /commit/i })
        .getAttribute("href"),
    ).toBe(`https://github.com/octocat/hello/commit/${COMMIT}`);
  });

  it("given an analyser skill changed by hand, when the window opens, then it stays « Déjà là, différent : laissé tel quel » and there is no button", async () => {
    const { panel, ui } = await openWindow({
      status: 200,
      body: {
        plan: plan([
          { path: SKILL, content: NEW, status: "exists", current: OLD },
          { path: AGENT, content: "x", status: "same" },
        ]),
      },
    });

    await ui.findByText(/Déjà là, différent : laissé tel quel/);

    expect(
      within(panel).queryByRole("button", {
        name: "Ajouter /analyser au repo",
      }),
    ).toBeNull();
  });
});
