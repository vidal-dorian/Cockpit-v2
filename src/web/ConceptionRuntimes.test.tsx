// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_MODULE,
  type FakeRuntime,
  runtime,
  stubConception,
  WEB_MODULE,
} from "./test-conception.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R6 (decision 052 J; screen S41): the runtimes line of the map says the end of life, in words and without a color more (decision 045 C).
//
// Pinned where the decision leaves it open (the developer follows these; the server answers GET /api/projects/5/versions as pinned in src/server/versions.test.ts, with
// `runtime(name, version, state, eolFrom)` of src/web/test-conception.tsx):
// - The line of a module is still its runtimes joined by « · », each « <nom> <version> ». A runtime of that module (same module path, name and version as the answer) in state `eol` is
//   followed by « fin de vie depuis <mois abrégé année> » as its own item of the line (« php 7.4 · fin de vie depuis nov. 2022 »), one in state `soon` by « fin de vie en <mois abrégé année> »
//   (« node 18 · fin de vie en avr. 2025 »); `ok` and `unknown` runtimes, and runtimes the answer does not know, stay as they were. The month is abbreviated as Intl does in French.
// - If the versions cannot be read (502), the line is the one of before. The versions are not asked when the project has no map.
// - No new color: the words carry the information (no element with a class containing « you- » in the line, no class naming a color token that the line did not have).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const main = () => screen.getByRole("main");
const loaded = (text: string) =>
  waitFor(() => expect(main().textContent).toContain(text));
const open = async (
  versions: FakeRuntime[] | "fail",
  modules = [API_MODULE, WEB_MODULE],
) => {
  const api = stubConception({ modules, versions });
  renderAt("/projets/5/conception");
  await loaded("Serveur");
  return api;
};

describe("decision 052 J: the runtimes line of the map", () => {
  it("given node 20 in end of life since April 2026, when the map loads, then the line says « node 20 · fin de vie depuis avr. 2026 · hono 4.6 »", async () => {
    await open([runtime("node", "20", "eol", "2026-04-30")]);

    await loaded("node 20 · fin de vie depuis avr. 2026 · hono 4.6");
  });

  it("given php 7.4 in end of life since November 2022, when the map loads, then the line says « php 7.4 · fin de vie depuis nov. 2022 »", async () => {
    const php = {
      ...API_MODULE,
      data: {
        ...API_MODULE.data,
        runtimes: [
          {
            name: "php",
            version: "7.4",
            citation: { path: "api/composer.json", start_line: 3, end_line: 3 },
          },
        ],
      },
    };
    await open([runtime("php", "7.4", "eol", "2022-11-28")], [php, WEB_MODULE]);

    await loaded("php 7.4 · fin de vie depuis nov. 2022");
  });

  it("given a runtime that will end in April 2027, when the map loads, then the line says « node 20 · fin de vie en avr. 2027 »", async () => {
    await open([runtime("node", "20", "soon", "2027-04-30")]);

    await loaded("node 20 · fin de vie en avr. 2027 · hono 4.6");
  });

  it("given runtimes ok and unknown, when the map loads, then the versions are asked and the line is the one of before", async () => {
    const api = await open([
      runtime("node", "20", "ok", null),
      runtime("hono", "4.6", "unknown", null),
    ]);

    await loaded("node 20 · hono 4.6");
    await waitFor(() =>
      expect(api.paths()).toContain("GET /api/projects/5/versions"),
    );
    expect(main().textContent).not.toContain("fin de vie");
  });

  it("given node 20 in end of life for the module api only, when the second module is shown, then its node 20 says nothing (the answer is per module)", async () => {
    await open([runtime("node", "20", "eol", "2026-04-30")]);
    await loaded("node 20 · fin de vie depuis avr. 2026");

    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);

    await loaded("node 20 · react 18.3");
    expect(main().textContent).not.toContain("fin de vie");
  });

  it("given the same runtime in end of life in both modules, when each is shown, then each line says it", async () => {
    await open([
      runtime("node", "20", "eol", "2026-04-30"),
      runtime("node", "20", "eol", "2026-04-30", {
        module: { path: "web", name: "Application" },
      }),
    ]);
    await loaded("node 20 · fin de vie depuis avr. 2026 · hono 4.6");

    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);

    await loaded("node 20 · fin de vie depuis avr. 2026 · react 18.3");
  });

  it("given the read of the versions failing, when the map loads, then the versions were asked and the line is the one of before", async () => {
    const api = await open("fail");

    await loaded("node 20 · hono 4.6");
    await waitFor(() =>
      expect(api.paths()).toContain("GET /api/projects/5/versions"),
    );
    expect(main().textContent).not.toContain("fin de vie");
  });

  it("given the line with an end of life, when it is read, then it has no element of the red tokens", async () => {
    await open([runtime("node", "20", "eol", "2026-04-30")]);
    await loaded("fin de vie depuis");

    const line = Array.from(main().querySelectorAll("*")).find(
      (el) =>
        el.children.length === 0 &&
        (el.textContent ?? "").includes("fin de vie depuis"),
    ) as HTMLElement;
    expect(line.closest('[class*="you-"]')).toBeNull();
    expect(line.className).not.toMatch(/you-/);
  });
});
