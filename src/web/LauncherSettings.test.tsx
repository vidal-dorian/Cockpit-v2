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

// Slice 14.1 (decision 054 A, D): the tab « Tâches cloud » of Réglages at /reglages/taches-cloud.
//
// Pinned choices (the decision leaves them open):
// - The tab shows the card « Écrire les US automatiquement » (022, unchanged) above a card « Lanceur Cockpit »: each is a
//   <section> found by its heading (level 2).
// - The launcher card reads GET /api/me/launcher ({ connected, needsReconnect, prompt, projectIds }), has « Copier la
//   consigne » (writes exactly the prompt of the launcher), the fields « Adresse de lancement » and « Jeton » (password) and
//   « Enregistrer » (PUT /api/me/launcher { fireUrl, token }).
// - It lists one checkbox per active project of GET /api/projects (an archived one is not listed), named by the full name of
//   the project, checked when its id is in projectIds; a click does PUT /api/projects/:id/launcher { inLauncher }.
// - /reglages/ecriture-us keeps showing the write-US card.

const ROUTINE_PROMPT = "ROUTINE-PROMPT write the stories";
const LAUNCHER_PROMPT = "LAUNCHER-PROMPT launch_id get_launch";
const FIRE_URL =
  "https://api.anthropic.com/v1/claude_code/routines/trig_01LAUNCHER/fire";
const TOKEN = "sk-ant-oat01-LAUNCHER-TOKEN-4c1d";

type Call = { method: string; path: string; body: string };
type Launcher = {
  connected: boolean;
  needsReconnect: boolean;
  prompt: string;
  projectIds: number[];
  missingProjectIds: number[];
};

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

function stubApi(launcher: Partial<Launcher> = {}) {
  const state: Launcher = {
    connected: false,
    needsReconnect: false,
    prompt: LAUNCHER_PROMPT,
    projectIds: [],
    missingProjectIds: [],
    ...launcher,
  };
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
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
      const body =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      calls.push({ method, path, body });
      if (path === "/api/setup/status")
        return Response.json({
          configured: true,
          detectedUrl: "http://localhost",
        });
      if (path === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (path === "/api/me")
        return Response.json({
          login: "dorian",
          name: "Dorian",
          avatarUrl: null,
          isAdmin: false,
        });
      if (path === "/api/installation")
        return Response.json({
          installed: true,
          installUrl: "https://github.com/apps/cockpit-test/installations/new",
        });
      if (path === "/api/me/tokens") return Response.json({ tokens: [] });
      if (path === "/api/me/connect")
        return Response.json({
          mcpUrl: "https://cockpit.example.com/mcp",
          connected: false,
          connectedAt: null,
          client: null,
        });
      if (path === "/api/projects" && method === "GET")
        return Response.json({
          projects: [
            {
              id: 5,
              fullName: "octocat/hello",
              defaultBranch: "main",
              archived: false,
            },
            {
              id: 6,
              fullName: "octocat/world",
              defaultBranch: "main",
              archived: false,
            },
            {
              id: 7,
              fullName: "octocat/old",
              defaultBranch: "main",
              archived: true,
            },
          ],
        });
      if (path === "/api/me/routine")
        return Response.json({
          connected: false,
          fireUrl: null,
          needsReconnect: false,
          prompt: ROUTINE_PROMPT,
        });
      if (path === "/api/me/launcher") {
        if (method === "GET") return Response.json(state);
        if (method === "PUT") {
          state.connected = true;
          return Response.json(state);
        }
        if (method === "DELETE") {
          state.connected = false;
          return new Response(null, { status: 204 });
        }
      }
      const project = /^\/api\/projects\/(\d+)\/launcher$/.exec(path);
      if (project && method === "PUT") {
        const id = Number(project[1]);
        const { inLauncher } = JSON.parse(body) as { inLauncher: boolean };
        state.projectIds = inLauncher
          ? [...state.projectIds, id]
          : state.projectIds.filter((p) => p !== id);
        return Response.json({ inLauncher });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }),
  );
  return calls;
}

function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

async function card(name: string) {
  const heading = await screen.findByRole("heading", { level: 2, name });
  const section = heading.closest("section");
  expect(
    section,
    `the heading ${name} must be inside a section`,
  ).not.toBeNull();
  return section as HTMLElement;
}
/** The launcher card once its data is read (the project toggles are there). */
async function launcherCard() {
  const section = await card("Lanceur Cockpit");
  await within(section).findByRole("checkbox", { name: /octocat\/hello/ });
  return section;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  window.history.replaceState({}, "", "/");
});

describe("criterion 9: the tab Tâches cloud", () => {
  it("given a user, when /reglages/taches-cloud loads, then the nav has the tab « Tâches cloud » (current page) and both cards are there, the writing of the US first", async () => {
    stubApi();

    renderAt("/reglages/taches-cloud");

    const write = await card("Écrire les US automatiquement");
    const launcher = await card("Lanceur Cockpit");
    expect(
      write.compareDocumentPosition(launcher) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const tab = within(
      screen.getByRole("navigation", { name: "Réglages" }),
    ).getByRole("link", { name: "Tâches cloud" });
    expect(tab.getAttribute("aria-current")).toBe("page");
  });

  it("given the old address, when /reglages/ecriture-us loads, then the card Écrire les US automatiquement is still there", async () => {
    stubApi();

    renderAt("/reglages/ecriture-us");

    expect(await card("Écrire les US automatiquement")).toBeDefined();
  });

  it("given the launcher card, when « Copier la consigne » is clicked, then the prompt of the launcher (not the one of the write-US task) is copied", async () => {
    const writeText = stubClipboard();
    stubApi();
    renderAt("/reglages/taches-cloud");
    const section = await launcherCard();

    fireEvent.click(
      within(section).getByRole("button", { name: "Copier la consigne" }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(LAUNCHER_PROMPT),
    );
  });

  it("given nothing connected, when the launcher card loads, then it has the fields Adresse de lancement and Jeton (password) and Enregistrer sends them to PUT /api/me/launcher", async () => {
    const calls = stubApi();
    renderAt("/reglages/taches-cloud");
    const section = await launcherCard();
    const token = within(section).getByLabelText("Jeton") as HTMLInputElement;
    expect(token.type).toBe("password");

    fireEvent.change(within(section).getByLabelText("Adresse de lancement"), {
      target: { value: FIRE_URL },
    });
    fireEvent.change(token, { target: { value: TOKEN } });
    fireEvent.click(
      within(section).getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() =>
      expect(
        calls.find((c) => c.method === "PUT" && c.path === "/api/me/launcher"),
      ).toBeDefined(),
    );
    const put = calls.find(
      (c) => c.method === "PUT" && c.path === "/api/me/launcher",
    );
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      fireUrl: FIRE_URL,
      token: TOKEN,
    });
    await waitFor(() =>
      expect(within(section).queryByDisplayValue(TOKEN)).toBeNull(),
    );
  });
});

describe("criterion 9: the projects of the launcher", () => {
  it("given two active projects and an archived one, when the card loads, then there is one toggle per active project, checked when ticked, and none for the archived one", async () => {
    stubApi({ connected: true, projectIds: [6] });
    renderAt("/reglages/taches-cloud");

    const section = await launcherCard();

    const boxes = within(section).getAllByRole(
      "checkbox",
    ) as HTMLInputElement[];
    expect(
      boxes.map(
        (b) => b.getAttribute("aria-label") ?? b.closest("label")?.textContent,
      ),
    ).toEqual([
      expect.stringContaining("octocat/hello"),
      expect.stringContaining("octocat/world"),
    ]);
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
    expect(section.textContent).not.toContain("octocat/old");
  });

  it("given an unticked project, when the user ticks it, then PUT /api/projects/5/launcher { inLauncher: true } is sent and the toggle stays checked", async () => {
    const calls = stubApi({ connected: true });
    renderAt("/reglages/taches-cloud");
    const section = await launcherCard();

    fireEvent.click(
      within(section).getByRole("checkbox", { name: /octocat\/hello/ }),
    );

    await waitFor(() =>
      expect(
        calls.find(
          (c) => c.method === "PUT" && c.path === "/api/projects/5/launcher",
        ),
      ).toBeDefined(),
    );
    const put = calls.find((c) => c.path === "/api/projects/5/launcher");
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ inLauncher: true });
    await waitFor(() =>
      expect(
        (
          within(section).getByRole("checkbox", {
            name: /octocat\/hello/,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true),
    );
  });
});

describe("criterion 9: a repo missing from the task (D)", () => {
  it("given a project whose repo Claude did not find, when the card loads, then it says so next to that project only", async () => {
    stubApi({ connected: true, missingProjectIds: [6] });
    renderAt("/reglages/taches-cloud");

    const section = await launcherCard();

    const label = (name: RegExp) =>
      within(section).getByRole("checkbox", { name }).closest("label");
    expect(label(/octocat\/world/)?.textContent).toMatch(
      /Le repo n'est pas dans la tâche/,
    );
    expect(label(/octocat\/hello/)?.textContent).not.toMatch(/repo absent/);
  });
});
