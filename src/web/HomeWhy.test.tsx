// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT } from "./test-home.tsx";
import { panel, stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 9.5 (decision 069 E): « Pourquoi Claude demande » in the panel of a question of the home.
// Pinned: the answer item also has `context: string | null` and `agent: string | null`.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const CONTEXT = "L'envoi de l'e-mail est en place, reste le nom du bouton.";
const answer = (over: Record<string, unknown> = {}) => ({
  kind: "answer",
  questionId: 7,
  question: "Quel nom pour le bouton ?",
  suggestedAnswers: null,
  runId: 17,
  storyId: 42,
  iWant: "relire les exports",
  project: PROJECT,
  context: CONTEXT,
  agent: "developer",
  ...over,
});

async function open(item: object) {
  stubShell({ forYou: [item] } as never);
  renderAt("/");
  await screen.findByRole("heading", { name: /1 · Maintenant/ });
  await waitFor(() =>
    expect(panel().textContent).toContain("Quel nom pour le bouton ?"),
  );
  return within(panel());
}
const text = () => (panel().textContent ?? "").replace(/\s+/g, " ");

describe("criterion 8: Pourquoi Claude demande on the home", () => {
  it("given an answer item with a context and agent developer, when the panel opens, then it shows Pourquoi Claude demande, the context, then « US 42 · étape developer · Run 17 ↗ » with the links to /us/42 and /runs/17", async () => {
    const p = await open(answer());

    const t = text();
    expect(t.indexOf("Pourquoi Claude demande")).toBeGreaterThan(-1);
    expect(t.indexOf(CONTEXT)).toBeGreaterThan(
      t.indexOf("Pourquoi Claude demande"),
    );
    expect(t.indexOf("US 42 · étape developer · Run 17 ↗")).toBeGreaterThan(
      t.indexOf(CONTEXT),
    );
    expect(p.getByRole("link", { name: /US 42/ }).getAttribute("href")).toBe(
      "/us/42",
    );
    expect(p.getByRole("link", { name: /Run 17/ }).getAttribute("href")).toBe(
      "/runs/17",
    );
  });

  it("given no context, when the panel opens, then there is no block and the line stays", async () => {
    const p = await open(answer({ context: null }));

    expect(p.queryByText("Pourquoi Claude demande")).toBeNull();
    expect(text()).toContain("US 42 · étape developer · Run 17 ↗");
  });

  it("given no agent, when the panel opens, then the line has no « étape »", async () => {
    await open(answer({ agent: null }));

    expect(text()).toContain("US 42 · Run 17 ↗");
    expect(text()).not.toContain("étape");
  });
});
