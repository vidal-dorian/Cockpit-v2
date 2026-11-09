// @vitest-environment jsdom
// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { fail, renderAt, story, ticket } from "./test-tickets.tsx";

// Slice 13.1 (decision 076 G): GET /api/stories/:id says `project.role`. On the page of a story the buttons of a gesture the role
// does not allow are hidden; a refusal 403 { error: "role" } of the server shows « Ton rôle sur ce projet ne le permet pas. ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

/** The decision fake, whose story route also says the role of the viewer on the project. */
function seed(role: string) {
  const api = stubDecisionApi({
    tickets: [ticket(7, "Idée découpée")],
    stories: [
      decisionStory(
        story(21, 7, "relire les exports", { status: "to_validate" }),
      ),
    ],
  });
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const res = await inner(input, init);
      const path = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        "http://localhost",
      ).pathname;
      if (path !== "/api/stories/21" || (init?.method ?? "GET") !== "GET")
        return res;
      const body = await res.json();
      return Response.json({ ...body, project: { ...body.project, role } });
    }),
  );
  return api;
}

const names = ["Valider", "Modifier", "Renvoyer à Claude", "Abandonner"];
const shown = () =>
  names.filter((n) => screen.queryByRole("button", { name: n }) !== null);
const loaded = () =>
  waitFor(() =>
    expect(screen.getByRole("main").textContent).toContain(
      "relire les exports",
    ),
  );

describe("the story page by role (076 G)", () => {
  it("given a read_only member, when the story page loads, then the four decision buttons are hidden", async () => {
    seed("read_only");

    renderAt("/us/21");
    await loaded();

    expect(shown()).toEqual([]);
  });

  it.each(["can_validate", "can_launch", "owner"])(
    "given a %s member, when the story page loads, then the four decision buttons are shown",
    async (role) => {
      seed(role);

      renderAt("/us/21");
      await loaded();

      expect(shown()).toEqual(names);
    },
  );

  it("given the server refusing with 403 role, when the member validates, then « Ton rôle sur ce projet ne le permet pas. » is shown", async () => {
    const api = seed("can_validate");
    api.failNext.validate = fail(403, "role");

    renderAt("/us/21");
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Ton rôle sur ce projet ne le permet pas.",
    );
  });
});
