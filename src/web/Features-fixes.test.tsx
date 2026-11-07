// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_MODULE, WEB_MODULE } from "./test-conception.tsx";
import {
  FACTURER,
  type FakeFeature,
  stubDownloads,
  stubFeatures,
} from "./test-features.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R3, review fixes (decisions 048 E, G, I, J).
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const open = async (features: FakeFeature[] = [FACTURER]) => {
  stubFeatures(features, [], { modules: [API_MODULE, WEB_MODULE] });
  renderAt("/projets/5/conception/fonctionnalites");
  await waitFor(() =>
    expect(
      within(screen.getByRole("main")).getByRole("heading", { level: 1 })
        .textContent,
    ).toMatch(/acteur|Pas encore/),
  );
};

describe("decision 048 E: the header", () => {
  it("given a feature, when the screen shows, then the export buttons sit in the header next to « Ouvrir sur GitHub ↗ »", async () => {
    await open();

    const header = screen.getByRole("heading", { level: 1 }).parentElement;
    for (const name of ["Exporter en Markdown", "Tout le projet"])
      expect(
        within(header as HTMLElement).getByRole("button", { name }),
      ).toBeDefined();
    expect(
      within(header as HTMLElement).getByRole("link", {
        name: "Ouvrir sur GitHub ↗",
      }),
    ).toBeDefined();
  });

  it("given the features still loading, when the screen shows, then the title is the project name, not the sentence of the map", async () => {
    stubFeatures([FACTURER], [], { modules: [API_MODULE] });
    renderAt("/projets/5/conception/fonctionnalites");

    const h1 = await screen.findByRole("heading", { level: 1 });

    expect(h1.textContent).not.toContain("Claude a lu");
  });
});

describe("decision 048 G: the unmapped objects in the graph view", () => {
  it("given an object absent from the map, when the graph shows, then the sentence and « Relancer l'analyse » are there", async () => {
    await open();

    expect(screen.getByRole("button", { name: "Graphe" })).toBeDefined();
    expect(
      screen.getAllByText(/Cet objet n'est pas dans la carte du code/).length,
    ).toBeGreaterThan(1);
  });
});

describe("decision 048 J: the window of the empty state", () => {
  it("given no feature, when the button is clicked, then the window opens with « Règles » checked", async () => {
    await open([]);

    fireEvent.click(
      screen.getByRole("button", { name: "Analyser avec Claude" }),
    );

    const window_ = await screen.findByRole("complementary", {
      name: "Analyser avec Claude",
    });
    expect(
      (within(window_).getByLabelText("Règles") as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("given an unmapped object, when « Relancer l'analyse » is clicked, then « Règles » is not checked", async () => {
    await open();

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Relancer l'analyse",
      })[0] as HTMLElement,
    );

    const window_ = await screen.findByRole("complementary", {
      name: "Analyser avec Claude",
    });
    expect(
      (within(window_).getByLabelText("Règles") as HTMLInputElement).checked,
    ).toBe(false);
  });
});

describe("decision 048 I: the download", () => {
  it("given an export, when it is clicked, then the Blob URL is revoked after the click, not during it", async () => {
    const downloads = stubDownloads();
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    try {
      await open();

      fireEvent.click(
        screen.getByRole("button", { name: "Exporter en Markdown" }),
      );

      expect(downloads.files).toHaveLength(1);
      expect(revoke).not.toHaveBeenCalled();
      await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    } finally {
      downloads.restore();
    }
  });
});
