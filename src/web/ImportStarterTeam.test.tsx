// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice 11.6 (decision 063 B, D): the import screen asks « Quelle équipe pour ce projet ? ».
//
// Pinned where the decision leaves it open:
// - On /projets, in the section « Importer depuis GitHub », above the list of repos (shown when the App is installed on at least one repo), one radio group
//   (role radiogroup, accessible name « Quelle équipe pour ce projet ? ») holds four radios, in the order Éco, Standard, Premium, Max. Each radio is labelled by its name
//   and its sentence (the sentence is inside the same label), Standard checked at the start. The choice is one for the page: it applies to the « Importer » button clicked next.
// - The POST /api/projects body is { githubRepoId, starterTeam } with the id of the level (eco, standard, premium, max).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const LEVELS = [
  { id: "eco", name: "Éco", sentence: "Le moins cher : pas de relecture." },
  { id: "standard", name: "Standard", sentence: "L'équipe de base, relue." },
  {
    id: "premium",
    name: "Premium",
    sentence: "Une relecture plus forte, et la doc tenue à jour.",
  },
  {
    id: "max",
    name: "Max",
    sentence: "Tout au plus puissant, avec une relecture de sécurité.",
  },
];

function stubApi() {
  const posted: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/projects" && method === "GET")
        return Response.json({ projects: [] });
      if (path === "/api/github/repositories")
        return Response.json({
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
          installed: true,
          repositories: [
            {
              githubRepoId: 10,
              fullName: "octocat/available",
              defaultBranch: "main",
              imported: false,
            },
          ],
        });
      if (path === "/api/projects" && method === "POST") {
        posted.push(JSON.parse(String(init?.body)));
        return Response.json(
          {
            project: {
              id: 110,
              fullName: "octocat/available",
              defaultBranch: "main",
              archived: false,
            },
          },
          { status: 201 },
        );
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return posted;
}

function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}
const group = async () =>
  within(
    await screen.findByRole("radiogroup", {
      name: "Quelle équipe pour ce projet ?",
    }),
  );

describe("decision 063 D: the choice of the team at the import", () => {
  it("given the import screen, when it loads, then « Quelle équipe pour ce projet ? » offers the four levels with their names and sentences, in order", async () => {
    stubApi();
    renderAt("/projets");

    const radios = (await group()).getAllByRole("radio");

    expect(radios).toHaveLength(4);
    LEVELS.forEach((level, i) => {
      const label = (radios[i] as HTMLElement).closest("label");
      expect(label?.textContent, level.name).toContain(level.name);
      expect(label?.textContent, level.name).toContain(level.sentence);
    });
  });

  it("given the import screen, when it loads, then Standard is the one chosen", async () => {
    stubApi();
    renderAt("/projets");

    const standard = (await group()).getByRole("radio", { name: /Standard/ });

    expect((standard as HTMLInputElement).checked).toBe(true);
    for (const other of ["Éco", "Premium", "Max"])
      expect(
        (
          (await group()).getByRole("radio", {
            name: new RegExp(other),
          }) as HTMLInputElement
        ).checked,
      ).toBe(false);
  });

  it("given nothing touched, when Importer is clicked, then the POST carries starterTeam standard", async () => {
    const posted = stubApi();
    renderAt("/projets");
    await group();

    fireEvent.click(await screen.findByRole("button", { name: "Importer" }));

    await waitFor(() =>
      expect(posted).toEqual([{ githubRepoId: 10, starterTeam: "standard" }]),
    );
  });

  it.each(LEVELS.filter((l) => l.id !== "standard"))(
    "given the level $name chosen, when Importer is clicked, then the POST carries starterTeam $id",
    async ({ id, name }) => {
      const posted = stubApi();
      renderAt("/projets");
      fireEvent.click(
        (await group()).getByRole("radio", { name: new RegExp(name) }),
      );

      fireEvent.click(await screen.findByRole("button", { name: "Importer" }));

      await waitFor(() =>
        expect(posted).toEqual([{ githubRepoId: 10, starterTeam: id }]),
      );
    },
  );
});
