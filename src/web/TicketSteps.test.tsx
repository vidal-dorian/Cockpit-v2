// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 4.3 (decisions 002 and 017 I): the six steps a ticket can have, in French, never the code of the server.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const LABELS: [string, string][] = [
  ["abandoned", "Abandonné"],
  ["new", "Nouveau"],
  ["in_progress", "En cours"],
  ["to_validate", "À valider"],
  ["done", "Terminé"],
  ["validated", "Validé"],
];

describe("criterion 16: the step labels", () => {
  it("given one ticket per step, when /projets/:id/tickets loads, then each row reads the French label of its step and never the code", async () => {
    stubTicketApi(
      LABELS.map(([code], i) => ({
        ...ticket(10 + i, `ticket-${code}`),
        step: code,
      })),
    );

    renderAt("/projets/5/tickets");

    for (const [code, label] of LABELS) {
      // Decision 054 F: a row is a button that opens the panel, no longer a link.
      const link = await screen.findByRole("button", {
        name: `ticket-${code}`,
      });
      const row = link.closest("li") as HTMLElement;
      expect(row, code).not.toBeNull();
      expect(within(row).getByText(label), code).toBeDefined();
    }
    expect(
      screen.queryByText(
        /^(abandoned|in_progress|to_validate|validated|done)$/,
      ),
    ).toBeNull();
  });

  it.each(LABELS)(
    "given a ticket at step %s, when /tickets/:id loads, then its step reads %s",
    async (code, label) => {
      stubTicketApi([{ ...ticket(7, "Un ticket"), step: code }]);

      renderAt("/tickets/7");

      await screen.findByRole("heading", { level: 1, name: /^Un ticket/ });
      expect(within(screen.getByRole("main")).getByText(label)).toBeDefined();
      expect(screen.queryByText(code)).toBeNull();
    },
  );
});
