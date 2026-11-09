// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE, PRO, renderAt, stubPlans } from "./test-plans.tsx";

// Slice 13.2 (decision 077 F, G, H; screen S49 as amended by 077): Réglages › Abonnement at /reglages/abonnement. Labels and contract: src/web/test-plans.tsx.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const NOT_OPEN =
  "Le paiement n'est pas encore ouvert. Si on t'a donné un code Pro, saisis-le ci-dessous.";

describe("S49, 077 F: the state sentence and the cards", () => {
  it("given a Free account with 2 repos, when /reglages/abonnement loads, then the menu has Abonnement, the sentence says Gratuit and 2 repos sur 3, and the three cards, the prices and Factures are shown", async () => {
    stubPlans({ plan: FREE });

    renderAt("/reglages/abonnement");

    await screen.findByText("2 repos sur 3 utilisés.");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Ton abonnement : Gratuit.",
    );
    expect(
      within(screen.getByRole("navigation", { name: "Réglages" })).getByRole(
        "link",
        { name: "Abonnement" },
      ),
    ).toBeDefined();
    for (const name of ["Gratuit", "Pro", "Entreprise"])
      expect(screen.getByRole("heading", { name }), name).toBeDefined();
    const page = document.body.textContent ?? "";
    expect(page).toContain("10 €");
    expect(page).toContain("96 €");
    expect(page).not.toContain("12 €");
    expect(page).not.toContain("Membres et partage");
    expect(screen.getByText("Aucune facture pour l'instant.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Passer à Pro" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Nous contacter" }),
    ).toBeDefined();
  });

  it("given a Free account with 3 repos, when the page loads, then the sentence says 3 repos sur 3 and to go Pro", async () => {
    stubPlans({ plan: { ...FREE, repos: 3 } });

    renderAt("/reglages/abonnement");

    await screen.findByText(
      "3 repos sur 3 utilisés. Passe à Pro pour en ajouter.",
    );
  });

  it.each([
    ["by a code with no end", PRO, "Par un code, sans fin."],
    [
      "by a code that ends",
      { ...PRO, until: "2027-03-12T12:00:00.000Z" },
      "Par un code, jusqu'au 12 mars 2027.",
    ],
    [
      "as the administrator",
      { ...PRO, via: "admin" as const },
      "En tant qu'administrateur de l'instance.",
    ],
  ])(
    "given a Pro account %s, when the page loads, then the sentence says Pro and %s",
    async (_name, plan, rest) => {
      stubPlans({ plan });

      renderAt("/reglages/abonnement");

      await screen.findByText(rest);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
        "Ton abonnement : Pro.",
      );
    },
  );
});

describe("S49, 077 G: no payment yet", () => {
  it.each(["Passer à Pro", "Nous contacter"])(
    "given a Free account, when %s is clicked, then the page says the payment is not open yet and nothing is sent",
    async (name) => {
      const calls = stubPlans({ plan: FREE });
      renderAt("/reglages/abonnement");
      await screen.findByText("2 repos sur 3 utilisés.");
      const before = calls.length;

      fireEvent.click(screen.getByRole("button", { name }));

      await screen.findByText(NOT_OPEN);
      expect(calls.length, "no request for a click").toBe(before);
    },
  );
});

describe("S49, 077 H: « J'ai un code Pro »", () => {
  it("given a good code, when it is typed and Activer clicked, then the code is posted and the sentence becomes Pro", async () => {
    const calls = stubPlans({ plan: FREE, givenPlan: PRO });
    renderAt("/reglages/abonnement");

    fireEvent.change(await screen.findByRole("textbox", { name: "Code Pro" }), {
      target: { value: "ABCD-1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activer" }));

    await screen.findByText("Par un code, sans fin.");
    expect(
      calls
        .filter((c) => c.method === "POST" && c.path === "/api/me/pro-code")
        .map((c) => c.body),
    ).toEqual([{ code: "ABCD-1234" }]);
  });

  it("given a bad code, when Activer is clicked, then « Ce code n'est pas valable. » is shown and the account stays Free", async () => {
    stubPlans({ plan: FREE });
    renderAt("/reglages/abonnement");

    fireEvent.change(await screen.findByRole("textbox", { name: "Code Pro" }), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activer" }));

    await screen.findByText("Ce code n'est pas valable.");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Gratuit",
    );
  });
});
