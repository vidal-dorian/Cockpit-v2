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

// Slice 7.5, criterion 8 (decision 037 E): the window « Développer avec Claude » also opens for an in_review story.
// Same pins as DevelopWindow.test.tsx: GET /api/stories/:id gives story.branch, the project says `archived`.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

function stub(options: { archived?: boolean } = {}) {
  stubTicketApi(
    [ticket(7, "Idée")],
    [story(42, 7, "Me connecter avec GitHub", { status: "in_review" })],
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
        body.story.branch = "us/42-me-connecter";
        body.story.prNumber = 12;
        body.project.archived = options.archived ?? false;
        return Response.json(body);
      }
      if (path === "/api/projects/5/branches")
        return Response.json({ branches: ["main", "us/42-me-connecter"] });
      if (path === "/api/projects/5/agents")
        return Response.json({
          agents: [],
          catalog: [],
          team: null,
          teams: [],
        });
      return inner(input, init);
    }),
  );
}

const loaded = () =>
  waitFor(() =>
    expect(screen.getByRole("main").textContent).toContain(
      "Me connecter avec GitHub",
    ),
  );

describe("criterion 8: the window for an in_review story", () => {
  it("given an in_review story of an active project, when /us/42 loads, then the button « Développer avec Claude » is shown", async () => {
    stub();
    renderAt("/us/42");
    await loaded();

    expect(
      await screen.findByRole("button", { name: "Développer avec Claude" }),
    ).toBeDefined();
  });

  it("given an in_review story of an archived project, when /us/42 loads, then there is no button", async () => {
    stub({ archived: true });
    renderAt("/us/42");
    await loaded();

    expect(
      screen.queryByRole("button", { name: "Développer avec Claude" }),
    ).toBeNull();
  });

  it("given the button, when it is clicked, then the panel opens with the branch of the story kept and the command on that branch", async () => {
    stub();
    renderAt("/us/42");
    await loaded();

    fireEvent.click(
      await screen.findByRole("button", { name: "Développer avec Claude" }),
    );

    const panel = await screen.findByRole("region", {
      name: "Développer avec Claude",
    });
    expect(within(panel).queryByRole("radio")).toBeNull();
    expect(panel.textContent).toContain("us/42-me-connecter");
    const folder = within(panel).getByLabelText("Dossier du clone");
    fireEvent.change(folder, { target: { value: "/home/dorian/code/hello" } });
    const href = within(panel)
      .getByText("Lancer Claude")
      .closest("a")
      ?.getAttribute("href");
    expect(decodeURIComponent(href ?? "")).toContain(
      "/dev-us 42 --branch us/42-me-connecter",
    );
  });
});
