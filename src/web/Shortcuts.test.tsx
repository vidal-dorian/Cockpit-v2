// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { PROJECT } from "./test-home.tsx";
import { panel, stubShell } from "./test-shell.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";

// Slice 15.3 (decision 073 E): J / K, V and ? (Ctrl K and N have their own tests).
//
// Pinned choices (the decision leaves them open):
// - J and K are keydowns on the document (key "j" / "k"): the panel of the home goes to the next / previous item (« 2 sur 3 »).
// - V clicks « Valider » of the story page /us/:id when the button is there (POST /api/stories/:id/validate); with no button, nothing.
// - ? opens a role="dialog" named « Raccourcis clavier » listing « Chercher », « Noter une idée », « Élément suivant, précédent » and « Valider ».
// - None of them fires from a field (the keydown target is an input or a textarea).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const item = (n: number) => ({
  kind: "validate",
  storyId: 20 + n,
  iWant: `faire la chose ${n}`,
  project: PROJECT,
});
const home = () => {
  stubShell({
    forYou: [item(1), item(2), item(3)],
    projects: [{ ...PROJECT, state: "idle" }],
  });
  renderAt("/");
};
const counter = (text: string) =>
  waitFor(() => expect(panel().textContent).toContain(text));

describe("slice 15.3 E: J and K", () => {
  it("given three items in the home panel, when J then K are pressed, then the counter goes to 2 sur 3 and back to 1 sur 3", async () => {
    home();
    await counter("1 sur 3");

    fireEvent.keyDown(document.body, { key: "j" });
    await counter("2 sur 3");
    expect(panel().textContent).toContain("faire la chose 2");
    fireEvent.keyDown(document.body, { key: "k" });
    await counter("1 sur 3");
  });

  it("given the panel on 1 sur 3, when J is pressed in the idea field, then it does not move, and from the page it does", async () => {
    home();
    await counter("1 sur 3");
    const field = await screen.findByRole("textbox", { name: "Idée" });

    fireEvent.keyDown(field, { key: "j" });
    await new Promise((r) => setTimeout(r, 50));
    expect(panel().textContent).toContain("1 sur 3");
    fireEvent.keyDown(document.body, { key: "j" });
    await counter("2 sur 3");
  });
});

describe("slice 15.3 E: V", () => {
  const storyPage = async (status: string) => {
    const api = stubDecisionApi({
      tickets: [ticket(7, "Idée découpée")],
      stories: [decisionStory(story(21, 7, "relire les exports", { status }))],
    });
    renderAt("/us/21");
    await screen.findAllByText(/relire les exports/);
    return api;
  };

  it("given a story to validate, when V is pressed, then POST /api/stories/21/validate is sent", async () => {
    const api = await storyPage("to_validate");
    await screen.findByRole("button", { name: /Valider/ });

    fireEvent.keyDown(document.body, { key: "v" });

    await waitFor(() =>
      expect(api.writes().map((c) => [c.method, c.path])).toEqual([
        ["POST", "/api/stories/21/validate"],
      ]),
    );
  });

  it("given a story to validate, when V is pressed in a field and then on the page, then only the second sends the validation", async () => {
    const api = await storyPage("to_validate");
    await screen.findByRole("button", { name: /Valider/ });
    const input = document.body.appendChild(document.createElement("input"));

    fireEvent.keyDown(input, { key: "v" });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.writes()).toEqual([]);
    fireEvent.keyDown(document.body, { key: "v" });

    await waitFor(() => expect(api.writes()).toHaveLength(1));
    input.remove();
  });
});

describe("slice 15.3 E: ?", () => {
  it("given a page, when ? is pressed, then the dialog Raccourcis clavier lists the shortcuts", async () => {
    home();
    await counter("1 sur 3");

    fireEvent.keyDown(document.body, { key: "?" });

    const d = await screen.findByRole("dialog", { name: "Raccourcis clavier" });
    for (const name of [
      "Chercher",
      "Noter une idée",
      "Élément suivant, précédent",
      "Valider",
    ])
      expect(within(d).getByText(name), name).toBeDefined();
  });

  it("given a page, when ? is pressed in a field, then no dialog opens", async () => {
    home();
    const field = await screen.findByRole("textbox", { name: "Idée" });

    fireEvent.keyDown(field, { key: "?" });
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByRole("dialog", { name: "Raccourcis clavier" }),
    ).toBeNull();
    fireEvent.keyDown(document.body, { key: "?" });

    expect(
      await screen.findByRole("dialog", { name: "Raccourcis clavier" }),
    ).toBeDefined();
  });
});
