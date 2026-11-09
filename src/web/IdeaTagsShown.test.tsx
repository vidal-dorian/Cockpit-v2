// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";
import { rich, stubTab } from "./test-tickets-full.tsx";

// Bug fix: the tags (and « priorité haute ») of an idea are shown on the « Idées » card of the Kanban and in the right panel of the ticket,
// as the rows of the « Tickets » tab already do.
// Pinned choices: the badges are plain text inside the card (the link #ticket-<id>) and inside aside[data-panel]; « priorité haute » is shown only for high.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const tagged = () =>
  rich(7, "Idée A", { tags: ["ux", "mobile"], priority: "high" });
const plain = () => rich(8, "Idée B");
const cardOf = async (id: number) => {
  const el = await waitFor(() => {
    const found = document.getElementById(`ticket-${id}`);
    if (!found) throw new Error(`no card ticket-${id}`);
    return found;
  });
  return within(el);
};

describe("bug: the tags of an idea are shown", () => {
  it("given the idea Idée A with tags ux, mobile and priority high, when the Kanban is shown, then its card shows the badges ux, mobile and priorité haute", async () => {
    stubTab([tagged()]);
    renderAt("/projets/5");

    const card = await cardOf(7);
    expect(card.getByText("ux")).toBeDefined();
    expect(card.getByText("mobile")).toBeDefined();
    expect(card.getByText("priorité haute")).toBeDefined();
  });

  it("given the same idea, when its card is opened at ?ticket=7, then the panel shows the badges ux, mobile and priorité haute", async () => {
    stubTab([tagged()]);
    renderAt("/projets/5?ticket=7");

    await screen.findByRole("link", { name: "Ouvrir le ticket" });
    const p = within(panel());
    expect(p.getByText("ux")).toBeDefined();
    expect(p.getByText("mobile")).toBeDefined();
    expect(p.getByText("priorité haute")).toBeDefined();
  });

  it("given a ticket with no tag and a normal priority, then neither the card nor the panel shows a badge for them, and the Ticket badge stays", async () => {
    stubTab([plain()]);
    renderAt("/projets/5?ticket=8");

    const card = await cardOf(8);
    await screen.findByRole("link", { name: "Ouvrir le ticket" });
    const p = within(panel());
    expect(card.queryByText("priorité haute")).toBeNull();
    expect(p.queryByText("priorité haute")).toBeNull();
    expect(p.getByText("Ticket")).toBeDefined();
  });

  it("given the same idea, when the Tickets tab is shown, then its row still shows the tags and priorité haute", async () => {
    stubTab([tagged()]);
    renderAt("/projets/5/tickets");

    const row = within(
      (await screen.findByText("Idée A")).closest("li") as HTMLElement,
    );
    expect(row.getByText("ux")).toBeDefined();
    expect(row.getByText("mobile")).toBeDefined();
    expect(row.getByText("priorité haute")).toBeDefined();
  });

  it("given the idea panel on the project page, when a tag is typed with Enter and another only typed, then the POST carries both and the Kanban card shows them once the list is read again", async () => {
    stubTab([]);
    // A fake server over the fake: the POST is recorded and the next list read gives the created idea back, as the real route does.
    const inner = globalThis.fetch;
    let body: { title: string; priority: string; tags: string[] } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const method = (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const path = new URL(raw, "http://localhost").pathname;
        if (path === "/api/projects/5/tickets" && method === "POST") {
          const text =
            typeof init?.body === "string"
              ? init.body
              : input instanceof Request
                ? await input.clone().text()
                : "";
          body = JSON.parse(text);
          return Response.json({ ticket: { id: 100 } }, { status: 201 });
        }
        if (path === "/api/projects/5/tickets" && method === "GET" && body)
          return Response.json({
            tickets: [rich(100, body.title, { tags: body.tags })],
          });
        return inner(input, init);
      }),
    );
    renderAt("/projets/5");

    const bar = await screen.findByRole("form", { name: "Noter une idée" });
    const field = within(bar).getByRole("textbox", { name: "Idée" });
    fireEvent.change(field, { target: { value: "Idée tagguée" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.submit(bar);
    const dialog = within(
      await screen.findByRole("dialog", { name: "Noter une idée" }),
    );
    const input = dialog.getByRole("combobox", { name: "Étiquette" });
    fireEvent.change(input, { target: { value: "ux" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "mobile" } });
    fireEvent.click(dialog.getByRole("button", { name: /^Noter/ }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ tags: ["ux", "mobile"] });
    const el = await waitFor(() => {
      const found = document.getElementById("ticket-100");
      if (!found) throw new Error("no card yet");
      return within(found);
    });
    expect(el.getByText("ux")).toBeDefined();
    expect(el.getByText("mobile")).toBeDefined();
  });
});
