// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Review of slice 7.2: the behaviour added after the acceptance tests.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

async function open(
  options: {
    iWant?: string;
    branches?: string[];
    teams?: "fail";
    defaultBranch?: string;
  } = {},
) {
  stubTicketApi(
    [ticket(7, "Idée")],
    [story(42, 7, options.iWant ?? "Me connecter", { status: "ready" })],
  );
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/stories/42") {
        const body = await (await inner(input, init)).json();
        body.story.branch = null;
        body.project.archived = false;
        body.project.defaultBranch = options.defaultBranch;
        return Response.json(body);
      }
      if (path === "/api/projects/5/branches")
        return Response.json({ branches: options.branches ?? ["main"] });
      if (path === "/api/projects/5/agents")
        return options.teams === "fail"
          ? Response.json({ error: "x" }, { status: 502 })
          : Response.json({ agents: [], catalog: [], team: null, teams: [] });
      return inner(input, init);
    }),
  );
  renderAt("/us/42");
  fireEvent.click(
    await screen.findByRole("button", { name: "Développer avec Claude" }),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Développer avec Claude",
  });
  return within(panel);
}
const type = (el: HTMLElement, value: string) =>
  fireEvent.change(el, { target: { value } });
const launch = (ui: ReturnType<typeof within>) =>
  ui.getByText("Lancer Claude").closest("a") as HTMLAnchorElement;

describe("review of the window", () => {
  it("given an empty folder, then the link is aria-disabled, the folder is required and a sentence says why, while copying stays possible", async () => {
    const ui = await open();

    expect(launch(ui).getAttribute("aria-disabled")).toBe("true");
    expect(
      (ui.getByLabelText("Dossier du clone") as HTMLInputElement).required,
    ).toBe(true);
    expect(
      ui.getByText("Indique le dossier du clone pour lancer Claude."),
    ).toBeDefined();
    expect(
      (
        ui.getByRole("button", {
          name: "Copier le prompt",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false); // the message holds no folder: copying stays the fallback (005)
  });

  it("given the existing mode with nothing picked, then a sentence asks for a branch; the default branch is not listed", async () => {
    const ui = await open({
      branches: ["main", "us/1-x", "a..b"],
      defaultBranch: "main",
    });
    await waitFor(() =>
      expect(
        (
          ui.getByRole("radio", {
            name: "Branche existante",
          }) as HTMLInputElement
        ).disabled,
      ).toBe(false),
    );

    fireEvent.click(ui.getByRole("radio", { name: "Branche existante" }));

    expect(ui.getByText("Choisis une branche existante.")).toBeDefined();
    const select = ui.getByRole("combobox", { name: "Branche existante" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual(["", "us/1-x"]);
  });

  it("given a failing agents call, then a sentence says the default team is used", async () => {
    const ui = await open({ teams: "fail" });

    expect(await ui.findByText(/Impossible de lire les équipes/)).toBeDefined();
  });

  it("given the panel, when « Annuler » is clicked, then the focus goes back to the button", async () => {
    const ui = await open();

    fireEvent.click(ui.getByRole("button", { name: "Annuler" }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Développer avec Claude" }),
      ),
    );
  });

  it("given a quoted folder and a prompt of spaces, then the link has the bare folder and no prompt", async () => {
    const ui = await open();

    type(ui.getByLabelText("Dossier du clone"), '  "C:\\code\\repo"  ');
    type(ui.getByLabelText("Prompt complémentaire"), "   ");

    expect(launch(ui).getAttribute("href")).toBe(
      `claude://code/new?folder=${encodeURIComponent("C:\\code\\repo")}&q=${encodeURIComponent("/dev-us 42 --branch us/42-me-connecter")}`,
    );
  });

  it("given an i_want without letters or digits, then the proposed name is us/42", async () => {
    const ui = await open({ iWant: "???" });

    expect(
      (ui.getByLabelText("Nom de la branche") as HTMLInputElement).value,
    ).toBe("us/42");
  });
});
