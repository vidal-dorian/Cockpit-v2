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
import { type FakeFinding, finding, stubFindings } from "./test-findings.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 084 B (finding 46 of the audit): after a decision on a finding, the panel opens the next finding to decide (counter « i sur n », J / K);
// at the end it closes. The order is the one of the screen: severity, then the most recent first.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

// Sorted by the screen: 1 (high), 2 (medium), 3 (low).
const three = (): FakeFinding[] => [
  finding(3, { severity: "low", title: "Troisième constat" }),
  finding(1, { severity: "high", title: "Premier constat" }),
  finding(2, { severity: "medium", title: "Deuxième constat" }),
];
const inPanel = () => within(panel());
const open = async (title: string) => {
  stubFindings(three());
  renderAt("/projets/5/conception/constats");
  await screen.findByRole("link", { name: /^Constats · \d+$/ });
  fireEvent.click(
    within(screen.getByRole("main")).getByRole("button", {
      name: `Ouvrir ${title}`,
    }),
  );
};
const title = () => inPanel().getAllByRole("heading")[0]?.textContent;
const closed = () =>
  waitFor(() => expect(document.querySelector("aside[data-panel]")).toBeNull());

describe("decision 084 B: the next finding after a decision", () => {
  it("given the first of 3 findings open, when the panel is read, then its counter says « 1 sur 3 »", async () => {
    await open("Premier constat");

    await inPanel().findByText("1 sur 3");
  });

  it("given the first finding open, when « En faire un ticket » is clicked, then the second is open with « 1 sur 2 »", async () => {
    await open("Premier constat");

    fireEvent.click(
      inPanel().getByRole("button", { name: "En faire un ticket" }),
    );

    await waitFor(() => expect(title()).toBe("Deuxième constat"));
    await inPanel().findByText("1 sur 2");
  });

  it("given the first finding open, when « Rejeter » is clicked, then the second is open", async () => {
    await open("Premier constat");

    fireEvent.click(inPanel().getByRole("button", { name: "Rejeter" }));

    await waitFor(() => expect(title()).toBe("Deuxième constat"));
  });

  it("given the first finding open, when « Plus tard » is clicked, then the second is open", async () => {
    await open("Premier constat");

    fireEvent.click(inPanel().getByRole("button", { name: "Plus tard" }));

    await waitFor(() => expect(title()).toBe("Deuxième constat"));
  });

  it("given the last finding open, when « En faire un ticket » is clicked, then the panel closes", async () => {
    await open("Troisième constat");

    fireEvent.click(
      inPanel().getByRole("button", { name: "En faire un ticket" }),
    );

    await closed();
  });

  it("given the first finding open, when J then K are pressed, then the second then the first are open", async () => {
    await open("Premier constat");

    fireEvent.keyDown(document.body, { key: "j" });
    await waitFor(() => expect(title()).toBe("Deuxième constat"));
    fireEvent.keyDown(document.body, { key: "k" });
    await waitFor(() => expect(title()).toBe("Premier constat"));
  });
});
