// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROJECT } from "./test-home.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Story S12 (decision 085 E): GET /api/home forYou also has { kind: "workflow_proposal", proposalId, path, reason, project }; its row is a link to /projets/:id/ci.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("S12: a workflow proposal on the home", () => {
  it("given a workflow proposal in forYou, when the home opens, then « 1 · Maintenant » has a link « Claude propose un changement de ci.yml » to /projets/5/ci", async () => {
    stubShell({
      forYou: [
        {
          kind: "workflow_proposal",
          proposalId: 9,
          path: ".github/workflows/ci.yml",
          reason: "Mettre en cache les dépendances npm",
          project: PROJECT,
        },
      ],
    } as never);
    renderAt("/");

    const heading = await screen.findByRole("heading", {
      name: /1 · Maintenant/,
    });
    const link = await within(
      heading.closest("section") as HTMLElement,
    ).findByRole("link", {
      name: /Claude propose un changement de ci\.yml/,
    });
    expect(link.getAttribute("href")).toBe("/projets/5/ci");
  });
});
