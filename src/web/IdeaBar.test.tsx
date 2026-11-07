// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubProjectShell, stubShell } from "./test-shell.tsx";
import { renderAt, ticket } from "./test-tickets.tsx";

// Slice 9.3 (decision 045 F): the idea bar at the bottom of every page of a logged-in user with a project.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const projects = [
  { id: 5, name: "octocat/hello", state: "idle" },
  { id: 8, name: "octocat/world", state: "idle" },
];

const bar = async () =>
  within(await screen.findByRole("form", { name: "Noter une idée" }));
const field = async () =>
  (await bar()).getByRole("textbox", { name: "Idée" }) as HTMLInputElement;
const send = async () =>
  (await bar()).getByRole("button", { name: "Noter l'idée" });

describe("slice 9.3: the idea bar", () => {
  it("given a project, when a page loads, then the bar has the Idée field, the Projet select and a disabled Noter l'idée button", async () => {
    stubShell({ projects });
    renderAt("/");

    await field();
    const select = (await bar()).getByRole("combobox", { name: "Projet" });
    expect(within(select).getAllByRole("option")).toHaveLength(2);
    expect((await send()).hasAttribute("disabled")).toBe(true);
    fireEvent.change(await field(), { target: { value: "   " } });
    expect((await send()).hasAttribute("disabled")).toBe(true);
    fireEvent.change(await field(), { target: { value: "une idée" } });
    expect((await send()).hasAttribute("disabled")).toBe(false);
  });

  it("given an idea typed and a project chosen, when I send it, then it POSTs { title } to that project, clears the field and says Idée notée dans {name}.", async () => {
    const api = stubShell({ projects });
    renderAt("/");

    fireEvent.change((await bar()).getByRole("combobox", { name: "Projet" }), {
      target: { value: "8" },
    });
    fireEvent.change(await field(), { target: { value: "ranger le Kanban" } });
    fireEvent.click(await send());

    await waitFor(() =>
      expect(api.sent).toContainEqual({
        method: "POST",
        path: "/api/projects/8/tickets",
        body: { title: "ranger le Kanban" },
      }),
    );
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Idée notée dans world.");
    expect((await field()).value).toBe("");
  });

  it("given the server refuses the idea, when I send it, then the sentence of the refusal is shown", async () => {
    stubShell({ projects }, { ticketStatus: 500 });
    renderAt("/");

    fireEvent.change(await field(), { target: { value: "x" } });
    fireEvent.click(await send());

    expect(
      await screen.findByText("L'opération a échoué, réessaie."),
    ).toBeDefined();
  });

  it("given I am on /projets/5, when the bar loads, then the Projet select defaults to that project", async () => {
    stubProjectShell({ projects }, [ticket(7, "Idée A")]);
    renderAt("/projets/5");

    const select = (await bar()).getByRole("combobox", {
      name: "Projet",
    }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("5"));
  });

  it("given a page, when I press n outside a field, then the Idée field gets the focus", async () => {
    stubShell({ projects });
    renderAt("/");

    const input = await field();
    fireEvent.keyDown(document.body, { key: "n" });

    expect(document.activeElement).toBe(input);
  });

  it("given the focus is in the Projet select, when I press n, then the focus stays there", async () => {
    stubShell({ projects });
    renderAt("/");

    await field();
    const select = (await bar()).getByRole("combobox", { name: "Projet" });
    select.focus();
    fireEvent.keyDown(select, { key: "n" });

    expect(document.activeElement).toBe(select);
  });

  it("given no project, when a page loads, then there is no idea bar", async () => {
    stubShell({});
    renderAt("/");

    await screen.findByText("Cockpit v0.1.0");
    expect(screen.queryByRole("form", { name: "Noter une idée" })).toBeNull();
  });
});
