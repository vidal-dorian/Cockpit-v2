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
import { API_MODULE, SHA_API, WEB_MODULE } from "./test-conception.tsx";
import {
  FACTURER,
  FILE,
  RELANCER,
  stubDownloads,
  stubFeatures,
} from "./test-features.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R3 (decision 048 I): « Exporter en Markdown » and « Tout le projet » on /projets/5/conception/fonctionnalites.
//
// Pinned (the developer follows these): both are buttons of <main>, always visible when there is a feature (no menu). A click builds the file in the browser (a Blob URL and a click
// on an anchor whose `download` is the name: `conception-<feature title>.md`, and `conception-<name of the repo>.md`, here `conception-hello.md`), with no request to the server
// beyond the reads of the screen. The content is the one of featuresMarkdown (src/web/features-markdown.test.ts): the chosen feature alone, or all of them.

let downloads: ReturnType<typeof stubDownloads>;
afterEach(() => {
  downloads?.restore();
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const open = async (path = "/projets/5/conception/fonctionnalites") => {
  downloads = stubDownloads();
  const api = stubFeatures([FACTURER, RELANCER], [], {
    modules: [API_MODULE, WEB_MODULE],
  });
  renderAt(path);
  await waitFor(() =>
    expect(
      within(screen.getByRole("main")).getByRole("heading", { level: 1 })
        .textContent,
    ).toContain("acteur"),
  );
  return api;
};
const click = (name: string) =>
  fireEvent.click(
    within(screen.getByRole("main")).getByRole("button", { name }),
  );

describe("decision 048 I: the export of the chosen feature", () => {
  it("given « Facturer » chosen, when « Exporter en Markdown » is clicked, then one file conception-Facturer.md is downloaded", async () => {
    await open();

    click("Exporter en Markdown");

    expect(downloads.files.map((f) => f.name)).toEqual([
      "conception-Facturer.md",
    ]);
  });

  it("given « Facturer » chosen, when it is exported, then the file holds its title, actors, rules with state and Étant donné / Quand / Alors, and one permalink per source", async () => {
    await open();

    click("Exporter en Markdown");
    const text = await downloads.files[0]?.text();

    expect(text).toMatch(/^#+ Facturer$/m);
    expect(text).toContain("Comptable");
    for (const r of FACTURER.rules)
      for (const part of [r.summary, r.given, r.when, r.then])
        expect(text).toContain(part);
    expect(text).toContain("voulue");
    expect(text).toContain(
      `https://github.com/octocat/hello/blob/${SHA_API}/${FILE}#L40-L58`,
    );
    expect(text?.match(/github\.com\/octocat\/hello\/blob\//g)).toHaveLength(4);
  });

  it("given an object of the map and one that is not, when the feature is exported, then the first has its fields and the other says « non cartographié »", async () => {
    await open();

    click("Exporter en Markdown");
    const text = await downloads.files[0]?.text();

    expect(text).toMatch(/total\W+integer/);
    expect(text).toContain("non cartographié");
    expect(text).not.toContain("Relancer les impayés");
  });

  it("given ?f=12, when « Exporter en Markdown » is clicked, then the file is the second feature's, conception-Relancer les impayés.md, without the first", async () => {
    await open("/projets/5/conception/fonctionnalites?f=12");

    click("Exporter en Markdown");
    const text = await downloads.files[0]?.text();

    expect(downloads.files[0]?.name).toBe("conception-Relancer les impayés.md");
    expect(text).toContain("Une relance part au bout de trente jours.");
    expect(text).not.toContain("Une facture garde le prix du jour.");
  });
});

describe("decision 048 I: the export of the whole project", () => {
  it("given two features, when « Tout le projet » is clicked, then one file conception-hello.md holds both of them", async () => {
    await open();

    click("Tout le projet");
    const text = await downloads.files[0]?.text();

    expect(downloads.files.map((f) => f.name)).toEqual(["conception-hello.md"]);
    expect(text).toMatch(/^#+ Facturer$/m);
    expect(text).toMatch(/^#+ Relancer les impayés$/m);
    expect(text).toMatch(/token\W+string/);
  });

  it("given the page, when a file is exported, then the server is asked for nothing more than the reads of the screen", async () => {
    const api = await open();
    const before = api.calls.length;

    click("Tout le projet");
    await downloads.files[0]?.text();

    expect(api.calls.slice(before).filter((c) => c.method !== "GET")).toEqual(
      [],
    );
  });
});
