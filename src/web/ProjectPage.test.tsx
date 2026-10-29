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

type Line = { key: string; ok: boolean; detail: string };
type Answer = { status: number; body: unknown };

const OK_LINES: Line[] = [
  { key: "claude_md", ok: true, detail: "ok" },
  { key: "ci", ok: true, detail: "ok" },
  { key: "mcp", ok: true, detail: "ok" },
  { key: "agents", ok: true, detail: "ok" },
];
const answer = (lines: Line[]): Answer => ({ status: 200, body: { lines } });
const fail = (status: number, error: string): Answer => ({
  status,
  body: { error },
});

const LABELS = {
  claude_md: "CLAUDE.md",
  ci: "CI",
  mcp: "Serveur MCP de Cockpit",
  agents: "Agents et skill de développement",
};

// The router lives inside App (browser router), so the tests set the URL like a browser would.
function renderAt(
  path: string,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  window.history.replaceState({}, "", path);
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

/**
 * A small fake server behind fetch. `answers` are served one per health request, the
 * last one again after that, so a refetch can show a change. A project that is not
 * in `projects` answers 404 like the real route.
 */
function stubApi(options: {
  projects?: { id: number; fullName: string }[];
  answers?: Answer[];
}) {
  const projects = options.projects ?? [{ id: 5, fullName: "octocat/hello" }];
  const answers = options.answers ?? [answer(OK_LINES)];
  const healthPaths: string[] = [];
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const path = new URL(raw, "http://localhost").pathname;
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({ login: "octocat", name: null, avatarUrl: null });
      if (path === "/api/projects" && method === "GET")
        return Response.json({
          projects: projects.map((p) => ({
            ...p,
            defaultBranch: "main",
            archived: false,
          })),
        });
      if (path === "/api/github/repositories" && method === "GET")
        return Response.json({
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
          installed: false,
          repositories: [],
        });
      // Slice 3.1: the page also lists the tickets of the project; these tests are about the health.
      if (/^\/api\/projects\/[^/]+\/stories$/.test(path) && method === "GET")
        return Response.json({ stories: [] });
      if (/^\/api\/projects\/[^/]+\/tickets$/.test(path) && method === "GET")
        return Response.json({ tickets: [] });
      const healthMatch = /^\/api\/projects\/([^/]+)\/health$/.exec(path);
      if (healthMatch && method === "GET") {
        healthPaths.push(path);
        if (!projects.some((p) => String(p.id) === healthMatch[1]))
          return Response.json({ error: "Not found" }, { status: 404 });
        const next =
          answers[Math.min(healthPaths.length - 1, answers.length - 1)];
        return Response.json(next?.body, { status: next?.status });
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { healthPaths };
}

/** The list item (or table row) that holds a given label. */
const rowOf = (text: string) => {
  const row = screen.getByText(text).closest("li, tr");
  expect(row, `${text} must be inside a list item or a row`).not.toBeNull();
  return row as HTMLElement;
};
const GREEN = /\bOK\b/;
const RED = /À corriger/;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("Project page, the health check", () => {
  it("given a project, when /projets/:id loads, then the title is its full name and the health is requested for that id", async () => {
    const { healthPaths } = stubApi({});

    renderAt("/projets/5");

    const title = await screen.findByRole("heading", {
      level: 1,
      name: "octocat/hello",
    });
    expect(title).toBeDefined();
    await screen.findByRole("heading", { name: "Bilan de santé" });
    expect(healthPaths).toContain("/api/projects/5/health");
  });

  it("given a project in the list, when its name is clicked on /projets, then the page of the project shows its health", async () => {
    stubApi({});
    renderAt("/projets");

    fireEvent.click(await screen.findByRole("link", { name: "octocat/hello" }));

    await screen.findByRole("heading", { level: 1, name: "octocat/hello" });
    expect(window.location.pathname).toBe("/projets/5");
    await screen.findByText(LABELS.ci);
  });

  it("given all lines ok, when the page loads, then the four French labels each read OK in text and none reads À corriger", async () => {
    stubApi({});

    renderAt("/projets/5");

    await screen.findByText(LABELS.claude_md);
    for (const label of Object.values(LABELS)) {
      const row = rowOf(label);
      expect(within(row).getByText(GREEN)).toBeDefined();
      expect(within(row).queryByText(RED)).toBeNull();
    }
    // In the documented order.
    const rows = Object.values(LABELS).map(rowOf);
    rows.slice(1).forEach((row, i) => {
      expect(
        (rows[i] as HTMLElement).compareDocumentPosition(row) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("given red lines, when the page loads, then each says À corriger in text with a short French explanation, the green one says OK, and no internal code is shown", async () => {
    stubApi({
      answers: [
        answer([
          { key: "claude_md", ok: true, detail: "ok" },
          { key: "ci", ok: false, detail: "missing" },
          { key: "mcp", ok: false, detail: "secret_in_clear" },
          { key: "agents", ok: false, detail: "missing" },
        ]),
      ],
    });

    renderAt("/projets/5");

    await screen.findByText(LABELS.claude_md);
    const green = rowOf(LABELS.claude_md);
    expect(within(green).getByText(GREEN)).toBeDefined();
    expect(within(green).queryByText(RED)).toBeNull();
    for (const key of ["ci", "mcp", "agents"] as const) {
      const label = LABELS[key];
      const row = rowOf(label);
      expect(within(row).getByText(RED), `${label} is red`).toBeDefined();
      expect(within(row).queryByText(GREEN)).toBeNull();
      const explanation = (row.textContent ?? "")
        .replace(label, "")
        .replace("À corriger", "")
        .trim();
      expect(
        explanation.length,
        `${label} needs an explanation`,
      ).toBeGreaterThan(10);
      expect(row.textContent).not.toMatch(
        /secret_in_clear|invalid_json|missing/,
      );
    }
    expect(rowOf(LABELS.mcp).textContent).toMatch(/secret/i);
  });

  it("given the .mcp.json is not valid JSON, when the page loads, then the Serveur MCP line says À corriger and mentions JSON", async () => {
    stubApi({
      answers: [
        answer([
          ...OK_LINES.slice(0, 2),
          { key: "mcp", ok: false, detail: "invalid_json" },
          OK_LINES[3] as Line,
        ]),
      ],
    });

    renderAt("/projets/5");

    await screen.findByText(LABELS.mcp);
    const row = rowOf(LABELS.mcp);
    expect(within(row).getByText(RED)).toBeDefined();
    expect(row.textContent).toMatch(/JSON/);
    expect(row.textContent).not.toContain("invalid_json");
  });

  it("given the Cockpit server is not declared, when the page loads, then the Serveur MCP line says À corriger with an explanation", async () => {
    stubApi({
      answers: [
        answer([
          ...OK_LINES.slice(0, 2),
          { key: "mcp", ok: false, detail: "missing" },
          OK_LINES[3] as Line,
        ]),
      ],
    });

    renderAt("/projets/5");

    await screen.findByText(LABELS.mcp);
    const row = rowOf(LABELS.mcp);
    expect(within(row).getByText(RED)).toBeDefined();
    expect(row.textContent).toMatch(/\.mcp\.json|MCP/);
    expect(row.textContent).not.toContain("missing");
  });

  it("given a red CI, when Revérifier is clicked, then the health is requested again and the line turns OK", async () => {
    const { healthPaths } = stubApi({
      answers: [
        answer([
          OK_LINES[0] as Line,
          { key: "ci", ok: false, detail: "missing" },
          ...OK_LINES.slice(2),
        ]),
        answer(OK_LINES),
      ],
    });
    renderAt("/projets/5");
    await screen.findByText(LABELS.ci);
    await waitFor(() =>
      expect(within(rowOf(LABELS.ci)).getByText(RED)).toBeDefined(),
    );
    expect(healthPaths).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Revérifier" }));

    await waitFor(() => expect(healthPaths).toHaveLength(2));
    await waitFor(() =>
      expect(within(rowOf(LABELS.ci)).getByText(GREEN)).toBeDefined(),
    );
    expect(within(rowOf(LABELS.ci)).queryByText(RED)).toBeNull();
  });

  it("given the page links back, when it loads, then a link to /projets is inside the page", async () => {
    stubApi({});

    renderAt("/projets/5");

    await screen.findByText(LABELS.ci);
    // The header navigation also has a Projets link: the page needs its own.
    const link = within(screen.getByRole("main")).getByRole("link", {
      name: /projets/i,
    });
    expect(link.getAttribute("href")).toBe("/projets");
  });
});

describe("Project page, errors", () => {
  it("given GitHub is unavailable (502), when the page loads, then a French alert mentions GitHub with a Réessayer button that requests again and shows the lines", async () => {
    const { healthPaths } = stubApi({
      answers: [fail(502, "github_unavailable"), answer(OK_LINES)],
    });

    renderAt("/projets/5");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/GitHub/);
    expect(alert.textContent).not.toContain("github_unavailable");
    expect(screen.queryByText(LABELS.ci)).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));

    await waitFor(() => expect(healthPaths).toHaveLength(2));
    await screen.findByText(LABELS.ci);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("given the App lost access to the repo (409 repo_unreachable), when the page loads, then a French alert says the App no longer has access to it and no internal code is shown", async () => {
    stubApi({ answers: [fail(409, "repo_unreachable")] });

    renderAt("/projets/5");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/App/);
    expect(alert.textContent).toMatch(/accès|voit/);
    expect(alert.textContent).not.toContain("repo_unreachable");
    expect(screen.queryByText(LABELS.ci)).toBeNull();
  });

  it("given the session expired (health answers 401), when the page loads, then it offers to log in with GitHub and shows no alert", async () => {
    stubApi({ answers: [fail(401, "Unauthorized")] });

    renderAt("/projets/5");

    const main = await screen.findByRole("main");
    const link = await within(main).findByRole("link", {
      name: "Se connecter avec GitHub",
    });
    expect(link.getAttribute("href")).toBe("/api/auth/login");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/GitHub ne répond pas/)).toBeNull();
  });

  it("given the app's default query options (retries on), when the health answers 502, then the alert shows at once after a single request", async () => {
    const { healthPaths } = stubApi({
      answers: [fail(502, "github_unavailable")],
    });

    renderAt("/projets/5", new QueryClient());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/GitHub/);
    expect(healthPaths).toHaveLength(1);
  });

  it("given the lines are shown, when the window regains focus, then the health is not requested again", async () => {
    const { healthPaths } = stubApi({});
    renderAt("/projets/5");
    await screen.findByText(LABELS.ci);
    expect(healthPaths).toHaveLength(1);

    window.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(healthPaths).toHaveLength(1);
  });

  it.each(["999", "abc"])(
    "given the project %s does not exist for the user, when its page loads, then it reads Projet introuvable with a link back to the projects",
    async (id) => {
      stubApi({});

      renderAt(`/projets/${id}`);

      await screen.findByText(/Projet introuvable/);
      expect(screen.queryByText(LABELS.ci)).toBeNull();
      const link = within(screen.getByRole("main")).getByRole("link", {
        name: /projets/i,
      });
      expect(link.getAttribute("href")).toBe("/projets");
    },
  );
});
