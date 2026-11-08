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

// Review of slice 9.3 (decision 045): the idea bar keeps its choice per page and the project it sent to; the Kanban says when it loads or fails.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const projects = [
  { id: 5, name: "octocat/hello", state: "claude" },
  { id: 8, name: "octocat/world", state: "claude" },
  { id: 9, name: "octocat/third", state: "claude" },
];
const bar = async () =>
  within(await screen.findByRole("form", { name: "Noter une idée" }));
const select = async () =>
  (await bar()).getByRole("combobox", { name: "Projet" }) as HTMLSelectElement;
const field = async () =>
  (await bar()).getByRole("textbox", { name: "Idée" }) as HTMLInputElement;
const send = async () =>
  (await bar()).getByRole("button", { name: "Noter l'idée" });

describe("review of slice 9.3: the idea bar", () => {
  it("given a project chosen on a project page, when I go to the page of another project, then the bar follows that page", async () => {
    stubShell({ projects });
    renderAt("/projets/5");
    await screen.findByRole("option", { name: "world" });
    fireEvent.change(await select(), { target: { value: "8" } });

    fireEvent.click(await screen.findByRole("link", { name: "octocat/third" }));

    await waitFor(async () => expect((await select()).value).toBe("9"));
  });

  // Decision 054 D: the bar's button opens the panel, whose « Noter » sends; it is disabled while sending, so a double click sends once.
  it("given an idea being sent from the panel, then « Noter » is disabled meanwhile and one ticket is sent", async () => {
    const api = stubShell({ projects });
    const inner = globalThis.fetch;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST" && String(input).includes("/tickets"))
          await gate;
        return inner(input, init);
      }),
    );
    renderAt("/");
    await screen.findByRole("option", { name: "world" });
    fireEvent.change(await field(), { target: { value: "première" } });

    fireEvent.click(await send());
    const panel = await screen.findByRole("dialog", { name: "Noter une idée" });
    const noter = within(panel).getByRole("button", {
      name: /^Noter/,
    }) as HTMLButtonElement;
    fireEvent.click(noter);
    await waitFor(() => expect(noter.disabled).toBe(true));
    fireEvent.click(noter);
    release();

    expect(await screen.findByRole("status")).toBeDefined();
    expect(api.sent).toHaveLength(1);
  });
});

describe("review of slice 9.3: the Kanban", () => {
  it("given the stories are not there yet, when /projets/5 loads, then the sentence says Chargement… and not that the board is empty", async () => {
    stubProjectShell({}, [ticket(7, "Idée A")]);
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (
          new URL(url, "http://localhost").pathname ===
          "/api/projects/5/stories"
        )
          return new Promise<Response>(() => {});
        return inner(input, init);
      }),
    );
    renderAt("/projets/5");

    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(
      "Chargement…",
    );
  });

  it("given the tickets cannot be read, when /projets/5 loads, then the Idées column says so instead of Aucune", async () => {
    stubProjectShell({}, [ticket(7, "Idée A")]);
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (
          new URL(url, "http://localhost").pathname ===
          "/api/projects/5/tickets"
        )
          return Response.json({ error: "x" }, { status: 500 });
        return inner(input, init);
      }),
    );
    renderAt("/projets/5");

    expect(
      await screen.findByText("Impossible de lire les tickets."),
    ).toBeDefined();
  });
});
