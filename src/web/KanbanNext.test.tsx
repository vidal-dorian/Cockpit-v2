// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { panel, withHome } from "./test-shell.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";

// Decision 085 B, G (« Pas encore fait »): Valider, Renvoyer or Abandonner on a card of the Kanban opens the next story of the same column
// (counter « i sur n » and J / K of Panel). At the end the panel closes and ?us= leaves the address, also after Abandonner.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const queue = (...ids: number[]) =>
  ids.map((id) =>
    decisionStory(story(id, 7, `vouloir-${id}`, { status: "to_validate" })),
  );
const load = (stories: ReturnType<typeof queue>) => {
  const api = stubDecisionApi({ tickets: [ticket(7, "Idée A")], stories });
  withHome({});
  return api;
};
const us = () => new URLSearchParams(window.location.search).get("us");
const inPanel = () => within(panel());
const opened = () => waitFor(() => panel());
const closed = () =>
  waitFor(() => expect(document.querySelector("aside[data-panel]")).toBeNull());

describe("decision 085 B, G: the next story of the column after a decision", () => {
  it("given the US 42 of 2 to validate open, when the panel is read, then its counter says « 1 sur 2 » (a ready US of another column is not counted)", async () => {
    load([
      ...queue(42, 43),
      decisionStory(story(50, 7, "vouloir-50", { status: "ready" })),
    ]);
    renderAt("/projets/5?us=42");

    await waitFor(() => panel());
    await inPanel().findByText("1 sur 2");
  });

  it("given 3 US to validate and the second open, when Valider is clicked, then POST validate and the third is open (?us=44)", async () => {
    const api = load(queue(42, 43, 44));
    renderAt("/projets/5?us=43");
    await waitFor(() => panel());

    fireEvent.click(await inPanel().findByRole("button", { name: "Valider" }));

    await waitFor(() => expect(us()).toBe("44"));
    expect(api.writes().map((c) => c.path)).toEqual([
      "/api/stories/43/validate",
    ]);
    await inPanel().findByText(/US 44/);
  });

  it("given the last US to validate open, when Valider is clicked, then the panel closes and ?us= leaves the address", async () => {
    load(queue(42));
    renderAt("/projets/5?us=42");
    await waitFor(() => panel());

    fireEvent.click(await inPanel().findByRole("button", { name: "Valider" }));

    await closed();
    expect(us()).toBeNull();
  });

  it("given 2 US to validate and the first open, when V is pressed, then it is validated and the second is open", async () => {
    load(queue(42, 43));
    renderAt("/projets/5?us=42");
    await opened();
    await inPanel().findByRole("button", { name: "Valider" });

    fireEvent.keyDown(document.body, { key: "v" });

    await waitFor(() => expect(us()).toBe("43"));
  });

  it("given 2 US to validate and the first open, when Renvoyer à Claude is sent with a comment, then the second is open", async () => {
    const api = load(queue(42, 43));
    renderAt("/projets/5?us=42");
    await opened();
    fireEvent.click(
      await inPanel().findByRole("button", { name: "Renvoyer à Claude" }),
    );
    fireEvent.change(inPanel().getByLabelText("Commentaire pour Claude"), {
      target: { value: "Précise le format" },
    });

    fireEvent.click(
      inPanel().getByRole("button", { name: "Renvoyer à Claude" }),
    );

    await waitFor(() => expect(us()).toBe("43"));
    expect(api.writes().map((c) => c.path)).toEqual([
      "/api/stories/42/send-back",
    ]);
  });

  it("given 2 US to validate and the first open, when its abandon is confirmed, then the second is open", async () => {
    load(queue(42, 43));
    renderAt("/projets/5?us=42");
    await opened();
    fireEvent.click(
      await inPanel().findByRole("button", { name: "Abandonner" }),
    );

    fireEvent.click(
      inPanel().getByRole("button", { name: "Confirmer l'abandon" }),
    );

    await waitFor(() => expect(us()).toBe("43"));
  });

  it("given the last US of the column open, when its abandon is confirmed, then the panel closes and ?us= does not stay in the address", async () => {
    load(queue(42));
    renderAt("/projets/5?us=42");
    await opened();
    fireEvent.click(
      await inPanel().findByRole("button", { name: "Abandonner" }),
    );

    fireEvent.click(
      inPanel().getByRole("button", { name: "Confirmer l'abandon" }),
    );

    await closed();
    await waitFor(() => expect(us()).toBeNull());
    expect(window.location.search).toBe("");
  });

  it("given the last US of the column open, when it is validated or abandoned, then the focus stays on the board and not on <body>", async () => {
    load(queue(42));
    renderAt("/projets/5?us=42");
    await opened();
    fireEvent.click(await inPanel().findByRole("button", { name: "Valider" }));
    await closed();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    cleanup();

    load(queue(42));
    renderAt("/projets/5?us=42");
    await opened();
    fireEvent.click(
      await inPanel().findByRole("button", { name: "Abandonner" }),
    );
    fireEvent.click(
      inPanel().getByRole("button", { name: "Confirmer l'abandon" }),
    );
    await closed();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });

  it("given 2 US to validate and the first open, when J then K are pressed, then the second then the first are open", async () => {
    load(queue(42, 43));
    renderAt("/projets/5?us=42");
    await opened();
    await inPanel().findByText("1 sur 2");

    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(us()).toBe("43"));
    await inPanel().findByText("2 sur 2");

    fireEvent.keyDown(document.body, { key: "k" });
    await waitFor(() => expect(us()).toBe("42"));
  });
});
