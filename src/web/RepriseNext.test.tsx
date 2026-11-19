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
import { type FakeRule, rule, stubReprise } from "./test-reprise.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 085 B (findings 47 and 48 of the audit): the panel of a rule names its US and its ticket and links the US (/us/:storyId);
// « Valider la règle » skips the rules already decided; after the last rule of a US it offers the way to validate the US (a link, 047 K stays).
// Pinned: GET /api/projects/5/rules already gives asA and ticketTitle with storyId (server/takeover.ts).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const mine = (id: number, over: Partial<FakeRule> = {}) =>
  ({
    ...rule(id, over),
    asA: "responsable paie",
    ticketTitle: "Reprise : factures",
  }) as FakeRule;
const inPanel = () => within(panel());
const open = async (
  list: FakeRule[],
  path = "/projets/5/conception/regles",
) => {
  stubReprise(list);
  renderAt(path);
  await waitFor(() => expect(panel().textContent).toMatch(/Règle \d+ sur \d+/));
};
const search = () => new URLSearchParams(window.location.search).get("regle");
const validate = () =>
  fireEvent.click(inPanel().getByRole("button", { name: /Valider la règle/ }));

describe("decision 085 B: the panel of a rule names its US", () => {
  it("given a rule of the US 31 of the ticket « Reprise : factures », when it is open, then the panel says « En tant que responsable paie » and the ticket, and links /us/31", async () => {
    await open([mine(1, { storyId: 31 })]);

    const link = inPanel().getByRole("link", { name: /responsable paie/ });
    expect(link.getAttribute("href")).toBe("/us/31");
    expect(panel().textContent).toContain("Reprise : factures");
  });
});

describe("decision 085 B: « Valider la règle » skips the rules already decided", () => {
  it("given the rule 2 already validated between two pending ones, when the rule 1 is validated, then the rule 3 is open (?regle=3)", async () => {
    await open([mine(1), mine(2, { state: "kept" }), mine(3)]);

    validate();

    await waitFor(() => expect(search()).toBe("3"));
    await waitFor(() => expect(panel().textContent).toContain("Règle 3 sur 3"));
  });

  it("given a pending rule before the validated one open, when the last pending one after it is validated, then it goes back to the first pending one", async () => {
    await open(
      [mine(1), mine(2, { state: "kept" }), mine(3)],
      "/projets/5/conception/regles?regle=3",
    );

    validate();

    await waitFor(() => expect(search()).toBe("1"));
  });
});

describe("decision 085 B: after the last rule of a US, the way to validate the US", () => {
  it("given the last pending rule of the US 31, when it is validated, then the notice says « Toutes les règles de cette US sont validées » with a link « Valider l'US » to /us/31", async () => {
    await open(
      [mine(1, { state: "kept" }), mine(2)],
      "/projets/5/conception/regles?regle=2",
    );

    validate();

    const link = await screen.findByRole("link", { name: "Valider l'US" });
    expect(link.getAttribute("href")).toBe("/us/31");
    expect(document.body.textContent).toContain(
      "Toutes les règles de cette US sont validées",
    );
  });

  it("given a rule validated while another rule of the same US is still pending, when it is validated, then there is no « Valider l'US » link", async () => {
    await open([mine(1), mine(2)]);

    validate();

    await waitFor(() =>
      expect(document.body.textContent).toContain("Règle validée."),
    );
    expect(screen.queryByRole("link", { name: "Valider l'US" })).toBeNull();
  });

  const bug = () =>
    fireEvent.click(inPanel().getByRole("button", { name: "C'est un bug" }));

  it("given a rule reported as a bug between a decided and a pending one, when « C'est un bug » is clicked, then the next pending rule opens", async () => {
    await open([mine(1), mine(2, { state: "kept" }), mine(3)]);

    bug();

    await waitFor(() => expect(search()).toBe("3"));
  });

  it("given the only rule of its US, when it is reported as a bug, then there is no « Valider l'US » link (the US is abandoned)", async () => {
    await open([mine(1)]);

    bug();

    await waitFor(() =>
      expect(document.body.textContent).toContain("Bug noté"),
    );
    expect(screen.queryByRole("link", { name: "Valider l'US" })).toBeNull();
  });
});
