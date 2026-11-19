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
import { renderAt, story, ticket } from "./test-tickets.tsx";

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

  // Decision 055 D changed 045 F: Enter (or the ↑ button) no longer creates the ticket, it opens the panel « Noter une idée »;
  // « Noter » of the panel creates (IdeaPanel.test.tsx). The project chosen in the bar is the one the panel starts with.
  it("given an idea typed and a project chosen, when I send it, then nothing is posted and the panel opens on that project with the title", async () => {
    const api = stubShell({ projects });
    renderAt("/");

    fireEvent.change((await bar()).getByRole("combobox", { name: "Projet" }), {
      target: { value: "8" },
    });
    fireEvent.change(await field(), { target: { value: "ranger le Kanban" } });
    fireEvent.click(await send());

    const panel = within(
      await screen.findByRole("dialog", { name: "Noter une idée" }),
    );
    expect(
      (panel.getByRole("textbox", { name: "Titre" }) as HTMLInputElement).value,
    ).toBe("ranger le Kanban");
    expect(
      (panel.getByRole("combobox", { name: "Projet" }) as HTMLSelectElement)
        .value,
    ).toBe("8");
    expect(api.sent.filter((s) => s.method === "POST")).toEqual([]);
  });

  // 055 D: the refusal now comes from « Noter » of the panel.
  it("given the server refuses the idea, when I send it from the panel, then the sentence of the refusal is shown", async () => {
    stubShell({ projects }, { ticketStatus: 500 });
    renderAt("/");

    fireEvent.change(await field(), { target: { value: "x" } });
    fireEvent.click(await send());
    const panel = within(
      await screen.findByRole("dialog", { name: "Noter une idée" }),
    );
    fireEvent.click(panel.getByRole("button", { name: /^Noter/ }));

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

// Decision 085 C (S10): the project of the page shown, then the last used; « Idée notée » links to the ticket.
// The first project of the home is the world (8), so a default of « the first one » is wrong on the pages of hello (5).
const worldFirst = [...projects].reverse();
const selected = async () =>
  (
    (await bar()).getByRole("combobox", {
      name: "Projet",
    }) as HTMLSelectElement
  ).value;

describe("085 C: the project the idea bar starts with", () => {
  it("given I am on the page of a story of project 5, when the bar loads, then the Projet select is project 5", async () => {
    stubProjectShell(
      { projects: worldFirst },
      [ticket(7, "Idée A")],
      [story(43, 7, "relire")],
    );
    renderAt("/us/43");

    await screen.findByRole("heading", { name: /relire/ });
    await waitFor(async () => expect(await selected()).toBe("5"));
  });

  it("given I am on the page of a ticket of project 5, when the bar loads, then the Projet select is project 5", async () => {
    stubProjectShell({ projects: worldFirst }, [ticket(7, "Idée A")]);
    renderAt("/tickets/7");

    await screen.findByText("Idée A");
    await waitFor(async () => expect(await selected()).toBe("5"));
  });

  it("given I am on the page of a run of project 5, when the bar loads, then the Projet select is project 5", async () => {
    const api = stubShell({ projects: worldFirst });
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (new URL(url, "http://localhost").pathname === "/api/runs/12")
          return Response.json({
            run: {
              id: 12,
              status: "running",
              branch: "us/42-login",
              model: "claude-x",
              comment: null,
              summary: null,
              startedAt: "2026-11-05T10:00:00.000Z",
              finishedAt: null,
            },
            steps: [],
            cloud: null,
            story: { id: 21, iWant: "relire les exports" },
            project: { id: 5, name: "octocat/hello" },
          });
        return inner(input, init);
      }),
    );
    expect(api).toBeDefined();
    renderAt("/runs/12");

    await screen.findByText(/Run 12/);
    await waitFor(async () => expect(await selected()).toBe("5"));
  });

  it("given an idea noted in project 8 from the home, when I am on another page without project, then the Projet select is still project 8", async () => {
    stubShell({ projects });
    renderAt("/");

    fireEvent.change(await field(), { target: { value: "ranger" } });
    fireEvent.click(await send());
    const panel = within(
      await screen.findByRole("dialog", { name: "Noter une idée" }),
    );
    fireEvent.change(panel.getByRole("combobox", { name: "Projet" }), {
      target: { value: "8" },
    });
    fireEvent.click(panel.getByRole("button", { name: /^Noter/ }));
    await screen.findByText("Idée notée dans world.");

    expect(await selected()).toBe("8");
  });
});

describe("085 C: « Idée notée » leads to the ticket", () => {
  it("given an idea noted, when Idée notée shows, then « Ouvrir le ticket » links to the ticket created", async () => {
    stubShell({ projects });
    renderAt("/");

    fireEvent.change(await field(), { target: { value: "ranger" } });
    fireEvent.click(await send());
    const panel = within(
      await screen.findByRole("dialog", { name: "Noter une idée" }),
    );
    fireEvent.click(panel.getByRole("button", { name: /^Noter/ }));
    await screen.findByText(/Idée notée dans hello/);

    const link = within(screen.getByRole("status")).getByRole("link", {
      name: "Ouvrir le ticket",
    });
    expect(link.getAttribute("href")).toBe("/tickets/100");
  });
});
