// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 13.1 (decision 076 G): the role of the project comes with GET /api/projects. A role that may not write sees no
// button of the ticket panel (Modifier, Supprimer) and none of « Préparer pour Claude » on the Santé tab.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

/** The ticket fake, whose project list says the role of the viewer, and whose health has a red line. */
function seed(role: string) {
  stubTicketApi([ticket(7, "Une idée")]);
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        "http://localhost",
      ).pathname;
      if (path === "/api/projects/5/health")
        return Response.json({
          lines: [{ key: "claude_md", ok: false, detail: "missing" }],
        });
      const res = await inner(input, init);
      if (path !== "/api/projects" || (init?.method ?? "GET") !== "GET")
        return res;
      const body = await res.json();
      return Response.json({
        projects: body.projects.map((p: object) => ({ ...p, role })),
      });
    }),
  );
}

describe("the ticket panel by role (076 G)", () => {
  it.each([
    ["read_only", false],
    ["can_validate", true],
  ])(
    "given a %s member, when a ticket is opened, then Modifier is shown: %s",
    async (role, shown) => {
      seed(role);
      renderAt("/projets/5/tickets");

      fireEvent.click(await screen.findByRole("button", { name: "Une idée" }));
      await screen.findByRole("link", { name: "Ouvrir le ticket" });

      await waitFor(() =>
        expect(screen.queryByRole("link", { name: "Modifier" }) !== null).toBe(
          shown,
        ),
      );
    },
  );
});

describe("the Santé tab by role (076 G)", () => {
  it.each([
    ["read_only", false],
    ["owner", true],
  ])(
    "given a %s member, when the bilan loads, then Préparer pour Claude is shown: %s",
    async (role, shown) => {
      seed(role);
      renderAt("/projets/5/sante");

      await screen.findByText("Le bilan");

      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Préparer pour Claude" }) !==
            null,
        ).toBe(shown),
      );
    },
  );
});
