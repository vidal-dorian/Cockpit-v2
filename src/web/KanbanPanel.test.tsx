// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { panel, stubProjectShell } from "./test-shell.tsx";
import { renderAt, story, ticket } from "./test-tickets.tsx";
import { stubWidth } from "./test-width.ts";

// Slice 9.5 (decision 069 G, H): a card of the Kanban opens in the right panel, at ?us=<id> or ?ticket=<id>.
// Decision 084 C3: from lg (1024 px) only; below, a card goes to its page (KanbanPhone.test.tsx). The clicks below are those of a desktop.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const tickets = [
  ticket(7, "Idée A"),
  { ...ticket(9, "Autre"), step: "in_progress" },
];
const board = [story(42, 9, "vouloir-alpha", { status: "to_validate" })];
const card = () => screen.findByRole("link", { name: /vouloir-alpha/ });
const board_ = () => screen.getByRole("region", { name: "Colonnes du Kanban" });

describe("criterion 9: a card opens in the right panel", () => {
  it("given the US 42 to validate, when its card is clicked, then the URL has ?us=42 and the panel shows Valider and Ouvrir l'US to /us/42 while the columns stay", async () => {
    stubWidth(1280);
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5");

    fireEvent.click(await card());

    await waitFor(() => expect(window.location.search).toBe("?us=42"));
    const p = within(await waitFor(() => panel()));
    await p.findByRole("button", { name: "Valider" });
    expect(
      p.getByRole("link", { name: "Ouvrir l'US" }).getAttribute("href"),
    ).toBe("/us/42");
    expect(board_()).toBeDefined();
  });

  it("given an open card, when it is clicked again, or Escape is pressed, then the panel closes, ?us disappears and the focus is back on the card", async () => {
    stubWidth(1280);
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5");
    fireEvent.click(await card());
    await waitFor(() => expect(panel()).toBeDefined());

    fireEvent.click(await card());
    await waitFor(() =>
      expect(document.querySelector("aside[data-panel]")).toBeNull(),
    );
    expect(window.location.search).toBe("");

    fireEvent.click(await card());
    await waitFor(() => expect(panel()).toBeDefined());
    fireEvent.keyDown(panel(), { key: "Escape" });
    await waitFor(() =>
      expect(document.querySelector("aside[data-panel]")).toBeNull(),
    );
    expect(window.location.search).toBe("");
    expect(document.activeElement).toBe(await card());
  });
});

describe("criterion 10: the address opens or ignores a card", () => {
  it("given /projets/5?ticket=7 where 7 is an idea of the board, when it loads, then the ticket panel is open with Ouvrir le ticket", async () => {
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5?ticket=7");

    const p = within(await waitFor(() => panel()));
    expect(
      await p.findByRole("link", { name: "Ouvrir le ticket" }),
    ).toBeDefined();
  });

  it("given ?us=999 which is not a card of the board, when it loads, then no panel opens", async () => {
    stubProjectShell({}, tickets, board);
    renderAt("/projets/5?us=999");

    await card();
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector("aside[data-panel]")).toBeNull();
  });
});
