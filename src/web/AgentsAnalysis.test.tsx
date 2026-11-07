// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

// Slice R5 (decision 051 L): the tab « Agents » shows the agents of the analysis apart, and their model is edited like any agent's (decision 030).
//
// Pinned where the decision leaves it open (the developer follows these):
// - GET /api/projects/:id/agents still answers { agents: [{ name, text }], catalog: [...] } with every file of `.claude/agents` of the repo.
// - The agents named cartographer, rules-analyst, bug-hunter, security-reviewer and architect are NOT in the section « Les agents du repo »: they are in their own <section>
//   (role region) named by the heading « Agents d'analyse », which is not inside the other section, in that order whatever the order of the repo, each with a button
//   « Ouvrir <name> » in a list item that says its name and its model (« Celui de la session » when it has none), exactly as the agents of the team do. The section is absent
//   when the repo has none of the five.
// - Opening one is the editor of decision 030: « Modèle » is the select, « Faire le commit » posts /api/projects/:id/agents/apply with { name, before, after }, `after` changing
//   only the model line.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const text = (name: string, model: string | null) =>
  `---\nname: ${name}\ndescription: Does ${name}\ntools: Read, Grep\n${model ? `model: ${model}\n` : ""}---\nYou are ${name}.\n`;
const DEV = text("developer", "sonnet");
const CARTO = text("cartographer", "opus");
const HUNTER = text("bug-hunter", "sonnet");
const SECURITY = text("security-reviewer", "opus");
const ARCHITECT = text("architect", null);
const SHA = "a".repeat(40);

function stubApi(agents: { name: string; text: string }[]) {
  const applies: Record<string, unknown>[] = [];
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
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: false,
            },
          ],
        });
      if (/^\/api\/projects\/5\/(stories|tickets)$/.test(path))
        return Response.json(
          path.endsWith("stories") ? { stories: [] } : { tickets: [] },
        );
      if (path === "/api/projects/5/routine")
        return Response.json({
          frequency: "off",
          hour: null,
          weekday: null,
          timeZone: "Europe/Paris",
          nextRunAt: null,
          lastRun: null,
        });
      if (path === "/api/me/routine")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: "This task is started by Cockpit.",
        });
      if (path === "/api/projects/5/health" && method === "GET")
        return Response.json({ lines: [] });
      if (path === "/api/projects/5/agents" && method === "GET")
        return Response.json({ agents, catalog: [] });
      if (path === "/api/projects/5/agents/apply" && method === "POST") {
        applies.push(JSON.parse(String(init?.body)));
        return Response.json({ commitSha: SHA });
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return applies;
}

function renderAgents() {
  window.history.replaceState({}, "", "/projets/5/agents");
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
const REPO_AGENTS = [
  { name: "architect", text: ARCHITECT },
  { name: "developer", text: DEV },
  { name: "security-reviewer", text: SECURITY },
  { name: "cartographer", text: CARTO },
  { name: "bug-hunter", text: HUNTER },
];
const analysis = async () =>
  (await screen.findByRole("region", {
    name: "Agents d'analyse",
  })) as HTMLElement;
const repoSection = () =>
  screen.getByRole("region", { name: "Les agents du repo" }) as HTMLElement;
const rowOf = (root: HTMLElement, name: string) =>
  within(root)
    .getAllByRole("listitem")
    .find(
      (li) =>
        within(li).queryByRole("button", { name: `Ouvrir ${name}` }) !== null,
    ) as HTMLElement;

describe("decision 051 L: the section « Agents d'analyse »", () => {
  it("given a repo with the developer and four agents of the analysis, when the tab opens, then they are in the section « Agents d'analyse », in the fixed order, and the developer stays in « Les agents du repo »", async () => {
    stubApi(REPO_AGENTS);
    renderAgents();

    const section = await analysis();

    expect(
      within(section)
        .getAllByRole("button", { name: /^Ouvrir / })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "Ouvrir cartographer",
      "Ouvrir bug-hunter",
      "Ouvrir security-reviewer",
      "Ouvrir architect",
    ]);
    expect(
      within(repoSection()).getByRole("button", { name: "Ouvrir developer" }),
    ).toBeDefined();
    expect(
      within(repoSection()).queryByRole("button", {
        name: "Ouvrir cartographer",
      }),
    ).toBeNull();
    expect(section.contains(repoSection())).toBe(false);
    expect(repoSection().contains(section)).toBe(false);
  });

  it("given the agents of the analysis, when the section is read, then each row says its model, « Celui de la session » when it has none", async () => {
    stubApi(REPO_AGENTS);
    renderAgents();
    const section = await analysis();

    expect(rowOf(section, "cartographer").textContent).toContain("opus");
    expect(rowOf(section, "bug-hunter").textContent).toContain("sonnet");
    expect(rowOf(section, "architect").textContent).toContain(
      "Celui de la session",
    );
  });

  it("given a repo with the developer and the bug-hunter only, when the tab opens, then the section lists the bug-hunter alone", async () => {
    stubApi([
      { name: "developer", text: DEV },
      { name: "bug-hunter", text: HUNTER },
    ]);
    renderAgents();

    const section = await analysis();

    expect(
      within(section)
        .getAllByRole("button", { name: /^Ouvrir / })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Ouvrir bug-hunter"]);
  });

  it("given the bug-hunter on sonnet, when I open it and choose opus, then « Faire le commit » posts { name, before, after } with only the model line changed", async () => {
    const applies = stubApi(REPO_AGENTS);
    renderAgents();
    const section = await analysis();
    fireEvent.click(
      within(section).getByRole("button", { name: "Ouvrir bug-hunter" }),
    );

    const model = (await screen.findByLabelText("Modèle")) as HTMLSelectElement;
    expect(model.value).toBe("sonnet");
    fireEvent.change(model, { target: { value: "opus" } });
    fireEvent.click(screen.getByRole("button", { name: "Faire le commit" }));

    await screen.findByText(/C'est fait/);
    expect(applies).toEqual([
      {
        name: "bug-hunter",
        before: HUNTER,
        after: HUNTER.replace("model: sonnet", "model: opus"),
      },
    ]);
  });
});
