// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT } from "./test-home.tsx";
import { panel, stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";
import { field } from "./ui.ts";

// Slice 15.1 (decision 071 E, G): on the phone the panel follows « 1 · Maintenant », whose card hides below lg; fields are 16 px below md.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const question = {
  kind: "answer",
  questionId: 7,
  question: "Quel nom pour le bouton ?",
  suggestedAnswers: ["Valider", "Envoyer"],
  runId: 12,
  storyId: 21,
  iWant: "relire les exports",
  project: PROJECT,
};
const validate = {
  kind: "validate",
  storyId: 22,
  iWant: "trier",
  project: PROJECT,
};

describe("slice 15.1: the home on the phone", () => {
  it("given a question first, when the home loads, then the panel follows « 1 · Maintenant » before « 2 · Ensuite » and the Maintenant card hides below lg", async () => {
    stubShell({ forYou: [question, validate] });
    renderAt("/");

    const now = (
      await screen.findByRole("heading", { name: /1 · Maintenant/ })
    ).closest("section") as HTMLElement;
    const next = screen
      .getByRole("heading", { name: /2 · Ensuite/ })
      .closest("section") as HTMLElement;
    const aside = await screen
      .findAllByText("Quel nom pour le bouton ?")
      .then(() => panel());
    expect(now.nextElementSibling).toBe(aside);
    expect(aside.nextElementSibling).toBe(next);
    expect(now.querySelector("div.grid")?.className).toContain(
      "hidden lg:grid",
    );
  });

  it("given the shared field token, when it is read, then it is 16 px below md", () => {
    expect(field).toContain("text-base");
    expect(field).toContain("md:text-[13.5px]");
  });
});
