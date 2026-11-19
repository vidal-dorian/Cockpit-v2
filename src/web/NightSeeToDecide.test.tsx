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
import { decisionStory, stubDecisionApi } from "./test-decisions.tsx";
import { PROJECT } from "./test-home.tsx";
import { story as fakeStory, renderAt, ticket } from "./test-tickets.tsx";

// Decision 085 A, C, D (slice S05): /nuit shows the story before « Valider et ajouter » (« Lire », in place, the programme kept),
// links the titles and the run during the night, and says where to act when the launch is disabled or the list empty.
// Pinned: GET /api/nights/current as in Night.test.tsx, an item of a night may carry `runId: number | null`;
// GET /api/stories/:id and POST /api/stories/:id/validate as in test-decisions.tsx; GET /api/me/launcher as in Night.test.tsx.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

type Item = {
  storyId: number;
  iWant: string;
  project: { id: number; name: string };
  estimatedSeconds: null;
  outcome: string | null;
  runId?: number | null;
};
const item = (
  storyId: number,
  outcome: string | null = null,
  runId?: number | null,
): Item => ({
  storyId,
  iWant: `faire la chose ${storyId}`,
  project: PROJECT,
  estimatedSeconds: null,
  outcome,
  ...(runId === undefined ? {} : { runId }),
});

type Options = {
  night?: { id: number; status: string; items: Item[] };
  ready?: Item[];
  toValidate?: Item[];
  connected?: boolean;
  projectIds?: number[];
};

function load(o: Options = {}) {
  const ids = [...(o.ready ?? []), ...(o.toValidate ?? [])].map(
    (s) => s.storyId,
  );
  const api = stubDecisionApi({
    tickets: [ticket(7, "Idée A")],
    stories: ids.map((id) =>
      decisionStory(
        fakeStory(id, 7, `faire la chose ${id}`, {
          asA: `rôle-${id}`,
          soThat: `but-${id}`,
          criteria: [
            {
              id: id * 10,
              position: 1,
              given: `état-${id}`,
              when: `action-${id}`,
              then: `résultat-${id}`,
            },
          ],
        }),
      ),
    ),
  });
  const inner = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/home")
        return Response.json({ forYou: [], claudeWorks: [], projects: [] });
      if (path === "/api/history")
        return Response.json({ entries: [], hasMore: false });
      if (path === "/api/installation")
        return Response.json({ installed: true, installUrl: "https://x" });
      if (path === "/api/nights/current")
        return Response.json({
          night: o.night ?? null,
          ready: o.ready ?? [],
          toValidate: o.toValidate ?? [],
        });
      if (path === "/api/me/night-hours")
        return Response.json({ startHour: 22, endHour: 7, timeZone: "UTC" });
      if (path === "/api/me/budgets")
        return Response.json({ runUsd: null, nightUsd: 5, monthUsd: null });
      if (path === "/api/me/launcher")
        return Response.json({
          connected: o.connected ?? true,
          needsReconnect: false,
          prompt: "P",
          projectIds: o.projectIds ?? [5],
          missingProjectIds: [],
          autoRelaunch: false,
        });
      if (path === "/api/me/routine")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "R",
        });
      return inner(input, init);
    }),
  );
  return api;
}

const rowOf = async (n: number) => {
  const found = (await screen.findAllByRole("listitem")).find((li) =>
    li.textContent?.includes(`faire la chose ${n}`),
  );
  if (!found) throw new Error(`no row for story ${n}`);
  return found;
};
const href = (el: HTMLElement) => el.getAttribute("href");

describe("decision 085 A: « Lire » unfolds the story above « Valider et ajouter »", () => {
  it("given a story to validate, when /nuit opens, then its row has a « Lire » button and shows no narrative yet", async () => {
    load({ toValidate: [item(3)] });
    renderAt("/nuit");

    const li = await rowOf(3);

    expect(within(li).getByRole("button", { name: "Lire" })).toBeDefined();
    expect(li.textContent).not.toContain("rôle-3");
  });

  it("given a story to validate, when « Lire » is clicked, then the narrative and the Given/When/Then criteria show in place with « Valider et ajouter » still there, and the page does not change", async () => {
    load({ toValidate: [item(3)] });
    renderAt("/nuit");

    fireEvent.click(
      within(await rowOf(3)).getByRole("button", { name: "Lire" }),
    );

    await waitFor(() => expect(screen.getByText(/rôle-3/)).toBeDefined());
    for (const part of ["but-3", "état-3", "action-3", "résultat-3"])
      expect(screen.getByText(new RegExp(part))).toBeDefined();
    expect(
      within(await rowOf(3)).getByRole("button", {
        name: "Valider et ajouter",
      }),
    ).toBeDefined();
    expect(window.location.pathname).toBe("/nuit");
  });

  it("given the story read, when « Valider et ajouter » is clicked, then the story is validated and joins the programme, which kept the story added before", async () => {
    const api = load({ ready: [item(1)], toValidate: [item(3)] });
    renderAt("/nuit");
    fireEvent.click(
      within(await rowOf(1)).getByRole("button", { name: "Ajouter" }),
    );
    fireEvent.click(
      within(await rowOf(3)).getByRole("button", { name: "Lire" }),
    );
    await screen.findByText(/rôle-3/);

    fireEvent.click(
      within(await rowOf(3)).getByRole("button", {
        name: "Valider et ajouter",
      }),
    );

    await waitFor(() =>
      expect(
        api.calls.some(
          (c) => c.method === "POST" && c.path === "/api/stories/3/validate",
        ),
      ).toBe(true),
    );
    const programme = (
      await screen.findByRole("heading", { level: 2, name: "Au programme" })
    ).closest("section") as HTMLElement;
    await waitFor(() => {
      expect(programme.textContent).toContain("faire la chose 1");
      expect(programme.textContent).toContain("faire la chose 3");
    });
  });

  it("given the story unfolded, when « Lire » is clicked again, then it folds back", async () => {
    load({ toValidate: [item(3)] });
    renderAt("/nuit");
    fireEvent.click(
      within(await rowOf(3)).getByRole("button", { name: "Lire" }),
    );
    await screen.findByText(/rôle-3/);

    fireEvent.click(
      within(await rowOf(3)).getByRole("button", { name: /Lire|Replier/ }),
    );

    await waitFor(() => expect(screen.queryByText(/rôle-3/)).toBeNull());
  });
});

describe("decision 085 C: titles and run links during the night", () => {
  it("given a running night, when /nuit opens, then each title links to /us/:id, the project name to /projets/:id, and the story with a run has a Run link to /runs/:id", async () => {
    load({
      night: {
        id: 1,
        status: "running",
        items: [item(1, "pr", 31), item(2, null, 32), item(3, null, null)],
      },
    });
    renderAt("/nuit");

    const first = await rowOf(1);
    expect(
      href(within(first).getByRole("link", { name: "faire la chose 1" })),
    ).toBe("/us/1");
    expect(href(within(first).getByRole("link", { name: PROJECT.name }))).toBe(
      "/projets/5",
    );
    expect(href(within(first).getByRole("link", { name: /Run/ }))).toBe(
      "/runs/31",
    );
    expect(
      href(within(await rowOf(2)).getByRole("link", { name: /Run/ })),
    ).toBe("/runs/32");
    const third = await rowOf(3);
    expect(
      href(within(third).getByRole("link", { name: "faire la chose 3" })),
    ).toBe("/us/3");
    expect(within(third).queryByRole("link", { name: /Run/ })).toBeNull();
  });

  it("given the evening with a story in the programme, when /nuit opens, then no title leaves the page (the programme would be lost)", async () => {
    load({ ready: [item(1)], toValidate: [item(3)] });
    renderAt("/nuit");
    fireEvent.click(
      within(await rowOf(1)).getByRole("button", { name: "Ajouter" }),
    );

    await rowOf(3);
    const main = screen.getByRole("main");
    expect(
      within(main).queryByRole("link", { name: /faire la chose/ }),
    ).toBeNull();
  });
});

describe("decision 085 D: the disabled launch and the empty list say where to act", () => {
  it("given no connected launcher, when /nuit opens, then « Connecte le lanceur » is a link to /reglages/taches-cloud", async () => {
    load({ connected: false, ready: [item(1)] });
    renderAt("/nuit");

    const link = await screen.findByRole("link", {
      name: /Connecte le lanceur/,
    });

    expect(href(link)).toBe("/reglages/taches-cloud");
  });

  it("given no project ticked for the night, when /nuit opens, then the empty list says so with a link to /reglages/taches-cloud", async () => {
    load({ projectIds: [] });
    renderAt("/nuit");

    const link = await screen.findByRole("link", {
      name: /Cocher des projets/,
    });

    expect(href(link)).toBe("/reglages/taches-cloud");
    expect(link.closest("li")?.textContent).toContain(
      "Aucun projet n'est coché pour la nuit",
    );
  });

  it("given a project ticked and no story, when /nuit opens, then the empty list keeps « Aucune user story à ajouter. » without the link to tick projects", async () => {
    load({ projectIds: [5] });
    renderAt("/nuit");

    await screen.findByText(/Aucune user story à ajouter\./);

    expect(
      screen.queryByRole("link", { name: /Cocher des projets/ }),
    ).toBeNull();
  });
});
