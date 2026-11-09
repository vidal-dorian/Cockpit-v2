// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_MODULE, stubConception } from "./test-conception.tsx";
import { patchProjects } from "./test-plans.tsx";
import { renderAt, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 13.2 (decision 077 D, E): the banner of a project that is read-only for the plan, and the window « Analyser avec Claude » without Pro. Labels and contract: src/web/test-plans.tsx.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const BANNER =
  "Ce projet est en lecture seule : l'abonnement Gratuit de @dorian couvre 3 projets.";

describe("077 E: the banner of a read-only project", () => {
  it("given a project locked by the plan of @dorian, when its tickets page loads, then the banner says so", async () => {
    stubTicketApi([ticket(7, "Une idée")]);
    patchProjects({ role: "read_only", lockedBy: "dorian" });

    renderAt("/projets/5/tickets");

    await screen.findByText(BANNER);
  });

  it("given a project that is not locked, when its tickets page loads, then there is no banner", async () => {
    stubTicketApi([ticket(7, "Une idée")]);
    patchProjects({ lockedBy: null });

    renderAt("/projets/5/tickets");

    await screen.findByRole("button", { name: "Une idée" });
    expect(screen.queryByText(BANNER, { exact: false })).toBeNull();
  });
});

describe("077 D: the window « Analyser » without Pro", () => {
  it("given a project whose owner is Free, when the window is opened, then it says the takeover is part of Pro with a link to Abonnement, and no Ouvrir Claude", async () => {
    stubConception({ modules: [] });
    patchProjects({ ownerPlan: "free" });
    renderAt("/projets/5/conception");

    fireEvent.click(
      await screen.findByRole("button", { name: "Analyser avec Claude" }),
    );

    await screen.findByText("La reprise fait partie de l'offre Pro.");
    const panel = await screen.findByRole("complementary", {
      name: "Analyser avec Claude",
    });
    const link = panel.querySelector('a[href="/reglages/abonnement"]');
    expect(link?.textContent).toContain("Abonnement");
    expect(panel.textContent).not.toContain("Ouvrir Claude");
  });

  it("given a project whose owner is Pro, when the window is opened, then Ouvrir Claude is there and the Pro sentence is not", async () => {
    stubConception({ modules: [API_MODULE] });
    patchProjects({ ownerPlan: "pro" });
    renderAt("/projets/5/conception");

    fireEvent.click(
      await screen.findByRole("button", { name: "Relancer l'analyse" }),
    );

    await screen.findByText("Ouvrir Claude");
    await waitFor(() =>
      expect(
        screen.queryByText("La reprise fait partie de l'offre Pro."),
      ).toBeNull(),
    );
  });
});
