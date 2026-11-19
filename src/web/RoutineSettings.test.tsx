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

// Decision 023 E moved the section to the tab /reglages/ecriture-us.
// Decision 022 A, C, G: the section « Écrire les US automatiquement » of Réglages, where the user connects the
// scheduled task of claude.ai (its launch address and its token), and the journal labels of the four new actions.
//
// Pinned choices (the decision leaves them open):
// - The page reads GET /api/me/routine, answering { connected, fireUrl, needsReconnect, prompt } (fireUrl null and
//   connected false when nothing is saved), saves with PUT /api/me/routine { fireUrl, token } and removes with
//   DELETE /api/me/routine (204). No confirmation is asked to remove it: pasting the token again undoes it.
// - The token field is a password field, and the token is never shown again once saved.
// - Journal labels: connect_routine « Tâche d'écriture des US connectée », disconnect_routine « Tâche d'écriture des
//   US retirée », schedule_routine « Planning d'écriture des US modifié », fire_write_us « Écriture des US lancée ».

type Routine = {
  connected: boolean;
  fireUrl: string | null;
  needsReconnect: boolean;
  prompt: string;
};
type State = {
  routine: Routine;
  /** What GET answers instead of the routine. */
  getAnswer?: Response;
  /** What PUT answers instead of saving. */
  putAnswer?: Response;
  /** The projects of GET /api/projects (none by default). */
  projects?: { id: number; fullName: string; archived: boolean }[];
  /** The schedule of each project, by id (off by default). */
  schedules?: Record<number, { frequency: string; hour: number | null }>;
};
type Call = { method: string; path: string; body: string };

const PROMPT =
  "This task is started by Cockpit. The `routine-fire-payload` block gives only the id of a Cockpit project. Call `list_tickets_needing_us` with that `project_id` and write the stories with `create_user_stories`.";
const FIRE_URL =
  "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCdef23/fire";
const TOKEN = "sk-ant-oat01-ROUTINE-TOKEN-9f3a";

const NOT_CONNECTED: Routine = {
  connected: false,
  fireUrl: null,
  needsReconnect: false,
  prompt: PROMPT,
};
const CONNECTED: Routine = {
  connected: true,
  fireUrl: FIRE_URL,
  needsReconnect: false,
  prompt: PROMPT,
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

/** A small fake server behind fetch: it keeps the routine, so a refetch shows the change. */
function stubApi(state: State) {
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
      if (path === "/api/me/tokens" && method === "GET")
        return Response.json({ tokens: [] });
      if (path === "/api/me/connect" && method === "GET")
        return Response.json({
          mcpUrl: "https://cockpit.example.com/mcp",
          connected: false,
          connectedAt: null,
          client: null,
        });
      if (path === "/api/projects" && method === "GET")
        return Response.json({
          projects: (state.projects ?? []).map((p) => ({
            ...p,
            defaultBranch: "main",
          })),
        });
      const schedule = /^\/api\/projects\/(\d+)\/routine$/.exec(path);
      if (schedule && method === "GET")
        return Response.json({
          frequency: "off",
          hour: null,
          weekday: null,
          timeZone: "Europe/Paris",
          nextRunAt: null,
          lastRun: null,
          ...state.schedules?.[Number(schedule[1])],
        });
      if (path === "/api/me/routine") {
        if (method === "GET")
          return state.getAnswer?.clone() ?? Response.json(state.routine);
        if (method === "PUT") {
          if (state.putAnswer) return state.putAnswer.clone();
          const sent = JSON.parse(body) as { fireUrl: string };
          state.routine = {
            connected: true,
            fireUrl: sent.fireUrl,
            needsReconnect: false,
            prompt: PROMPT,
          };
          return Response.json(state.routine);
        }
        if (method === "DELETE") {
          state.routine = { ...NOT_CONNECTED };
          return new Response(null, { status: 204 });
        }
      }
      throw new Error(`Unexpected fetch ${method} ${raw}`);
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

/** The section, found by its heading. */
async function routineSection() {
  const heading = await screen.findByRole("heading", {
    name: "Écrire les US automatiquement",
  });
  const section = heading.closest("section");
  expect(section, "the heading must be inside a section").not.toBeNull();
  return section as HTMLElement;
}

/** Waits for the routine to be read: the form (or « Connectée ») is there. */
async function loadedSection() {
  const section = await routineSection();
  await waitFor(() =>
    expect(
      within(section).queryByText("Chargement…"),
      "the routine is loaded",
    ).toBeNull(),
  );
  return section;
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  window.history.replaceState({}, "", "/");
});

describe("Réglages page, the section Écrire les US automatiquement", () => {
  it("given a user, when /reglages loads, then the section has its heading and a link to the routines of claude.ai that opens in a new tab with rel noreferrer", async () => {
    stubApi({ routine: NOT_CONNECTED });

    renderAt("/reglages/ecriture-us");

    const section = await loadedSection();
    const link = within(section)
      .getAllByRole("link")
      .find(
        (a) => a.getAttribute("href") === "https://claude.ai/code/routines",
      );
    expect(link, "a link to https://claude.ai/code/routines").toBeDefined();
    if (!link) return;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toMatch(/\bnoreferrer\b/);
  });

  it("given a user on /reglages/ecriture-us, when the section loads, then step 2 « Décocher les connecteurs » is its own step telling to uncheck every connector sauf Cockpit, step 1 no longer talks about connectors and the next steps are 3 and 4 (022 A)", async () => {
    stubApi({ routine: NOT_CONNECTED });

    renderAt("/reglages/ecriture-us");

    const section = await loadedSection();
    const steps = within(section)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    const step = (title: string) => steps.find((t) => t.startsWith(title));

    const step1 = step("1. Créer la tâche sur claude.ai");
    expect(step1, "step 1 exists").toBeDefined();
    expect(step1).not.toMatch(/connecteur/i);
    const step2 = step("2. Décocher les connecteurs");
    expect(step2, "its own step 2. Décocher les connecteurs").toBeDefined();
    expect(step2).toContain("sauf Cockpit");
    expect(step("3. Copier la consigne"), "step 3").toBeDefined();
    expect(step("4. Coller l'adresse et le jeton"), "step 4").toBeDefined();
  });

  it("given nothing connected, when the section loads, then the prompt is shown and « Copier la consigne » writes exactly the prompt of the server to the clipboard", async () => {
    const writeText = stubClipboard();
    stubApi({ routine: NOT_CONNECTED });
    renderAt("/reglages/ecriture-us");
    const section = await loadedSection();

    fireEvent.click(
      await within(section).findByRole("button", {
        name: "Copier la consigne",
      }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PROMPT));
    const shown =
      within(section).queryByDisplayValue(PROMPT) ??
      within(section).queryByText(PROMPT);
    expect(
      shown,
      "the prompt must be readable before it is copied",
    ).not.toBeNull();
  });

  it("given nothing connected, when the section loads, then it has the fields Adresse de lancement and Jeton (a password field) and an Enregistrer button, and does not claim to be connected", async () => {
    stubApi({ routine: NOT_CONNECTED });

    renderAt("/reglages/ecriture-us");

    const section = await loadedSection();
    expect(
      within(section).getByLabelText("Adresse de lancement"),
    ).toBeDefined();
    const token = within(section).getByLabelText("Jeton");
    expect(token.getAttribute("type")).toBe("password");
    expect(
      within(section).getByRole("button", { name: "Enregistrer" }),
    ).toBeDefined();
    expect(within(section).queryByText("Connectée")).toBeNull();
    expect(
      within(section).queryByRole("button", { name: "Retirer" }),
    ).toBeNull();
  });

  it("given the fields filled, when Enregistrer is clicked, then the address and the token are sent with PUT /api/me/routine and the section says Connectée with a Retirer button", async () => {
    const calls = stubApi({ routine: NOT_CONNECTED });
    renderAt("/reglages/ecriture-us");
    const section = await loadedSection();
    fireEvent.change(within(section).getByLabelText("Adresse de lancement"), {
      target: { value: FIRE_URL },
    });
    fireEvent.change(within(section).getByLabelText("Jeton"), {
      target: { value: TOKEN },
    });

    fireEvent.click(
      within(section).getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() =>
      expect(within(section).getByText("Connectée")).toBeDefined(),
    );
    expect(
      within(section).getByRole("button", { name: "Retirer" }),
    ).toBeDefined();
    const put = writes(calls).filter((c) => c.path === "/api/me/routine");
    expect(put).toHaveLength(1);
    expect(put[0]?.method).toBe("PUT");
    expect(JSON.parse(put[0]?.body ?? "{}")).toEqual({
      fireUrl: FIRE_URL,
      token: TOKEN,
    });
  });

  it("given a token just saved, when the section is connected, then the token is shown nowhere: not in the text and not in any field", async () => {
    stubApi({ routine: NOT_CONNECTED });
    renderAt("/reglages/ecriture-us");
    const section = await loadedSection();
    fireEvent.change(within(section).getByLabelText("Adresse de lancement"), {
      target: { value: FIRE_URL },
    });
    fireEvent.change(within(section).getByLabelText("Jeton"), {
      target: { value: TOKEN },
    });
    fireEvent.click(
      within(section).getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() =>
      expect(within(section).getByText("Connectée")).toBeDefined(),
    );

    expect(document.body.textContent).not.toContain(TOKEN);
    expect(within(section).queryByDisplayValue(TOKEN)).toBeNull();
  });

  it("given a connected routine, when the section loads, then it says Connectée and offers Retirer", async () => {
    stubApi({ routine: CONNECTED });

    renderAt("/reglages/ecriture-us");

    const section = await loadedSection();
    await waitFor(() =>
      expect(within(section).getByText("Connectée")).toBeDefined(),
    );
    expect(
      within(section).getByRole("button", { name: "Retirer" }),
    ).toBeDefined();
    expect(within(section).queryByText(/à reconnecter/)).toBeNull();
  });

  it("given a connected routine, when Retirer is clicked, then, once confirmed (085), DELETE /api/me/routine is sent and the section offers the fields again", async () => {
    const calls = stubApi({ routine: CONNECTED });
    renderAt("/reglages/ecriture-us");
    const section = await loadedSection();

    fireEvent.click(
      await within(section).findByRole("button", { name: "Retirer" }),
    );
    fireEvent.click(
      within(section).getByRole("button", { name: "Confirmer le retrait" }),
    );

    await waitFor(() =>
      expect(within(section).getByLabelText("Jeton")).toBeDefined(),
    );
    const sent = writes(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: "DELETE",
      path: "/api/me/routine",
    });
    expect(within(section).queryByText("Connectée")).toBeNull();
    expect(
      within(section).queryByRole("button", { name: "Retirer" }),
    ).toBeNull();
  });

  it("given a routine that needs reconnecting, when the section loads, then it says to reconnect (new token, « Régénérer » on claude.ai), shows the fields to paste it and no longer says Connectée", async () => {
    stubApi({ routine: { ...CONNECTED, needsReconnect: true } });

    renderAt("/reglages/ecriture-us");

    const section = await loadedSection();
    await waitFor(() => expect(section.textContent).toMatch(/à reconnecter/));
    expect(section.textContent).toContain("Régénérer");
    expect(within(section).getByLabelText("Jeton")).toBeDefined();
    expect(
      within(section).getByRole("button", { name: "Enregistrer" }),
    ).toBeDefined();
    expect(within(section).queryByText("Connectée")).toBeNull();
    // 022 C: « Retirer » stays reachable when the task is gone from claude.ai.
    expect(
      within(section).getByRole("button", { name: "Retirer" }),
    ).toBeDefined();
  });

  it.each([
    ["Bad request", 400, /adresse|jeton/i],
    ["Internal Server Error", 500, /échoué|réessaie/i],
  ])(
    "given the server answers %s (%i) to the save, when Enregistrer is clicked, then an alert explains it in French, without the raw code, and the fields stay",
    async (code, status, french) => {
      stubApi({
        routine: NOT_CONNECTED,
        putAnswer: Response.json({ error: code }, { status }),
      });
      renderAt("/reglages/ecriture-us");
      const section = await loadedSection();
      fireEvent.change(within(section).getByLabelText("Adresse de lancement"), {
        target: { value: "https://example.com/x" },
      });
      fireEvent.change(within(section).getByLabelText("Jeton"), {
        target: { value: "abc" },
      });

      fireEvent.click(
        within(section).getByRole("button", { name: "Enregistrer" }),
      );

      const alert = await within(section).findByRole("alert");
      expect(alert.textContent).toMatch(french);
      expect(alert.textContent).not.toContain(code);
      expect(alert.textContent).not.toMatch(/\b(400|500)\b|HTTP/);
      expect(within(section).queryByText("Connectée")).toBeNull();
      expect(
        within(section).getByLabelText("Adresse de lancement"),
      ).toBeDefined();
    },
  );

  it("given the routine cannot be read (server error), when the section loads, then an alert in French shows in the section, without HTTP nor the status", async () => {
    stubApi({
      routine: NOT_CONNECTED,
      getAnswer: Response.json({ error: "boom" }, { status: 500 }),
    });

    renderAt("/reglages/ecriture-us");

    const section = await routineSection();
    const alert = await within(section).findByRole("alert");
    expect(alert.textContent?.trim()).not.toBe("");
    expect(alert.textContent).not.toMatch(/HTTP|500|boom/);
  });
});

const PROJECTS = [
  { id: 5, fullName: "octocat/hello", archived: false },
  { id: 6, fullName: "octocat/world", archived: false },
  { id: 7, fullName: "octocat/old", archived: true },
];

// Decision 085 Q (S13): Réglages › Tâches cloud lists the frequency of each active project with a link to its settings.
describe("Réglages page, the frequency of each project under Connectée (085 Q)", () => {
  it("given a connected routine and two active projects, when the section loads, then each project is a link to /projets/:id/reglages with its frequency, and an archived project is not listed", async () => {
    stubApi({
      routine: CONNECTED,
      projects: PROJECTS,
      schedules: { 5: { frequency: "daily", hour: 7 } },
    });

    renderAt("/reglages/taches-cloud");

    const section = await loadedSection();
    const hello = await within(section).findByRole("link", {
      name: "octocat/hello",
    });
    expect(hello.getAttribute("href")).toBe("/projets/5/reglages");
    await waitFor(() =>
      expect(hello.closest("li")?.textContent).toContain("chaque jour à 7 h"),
    );
    const world = within(section).getByRole("link", { name: "octocat/world" });
    expect(world.getAttribute("href")).toBe("/projets/6/reglages");
    await waitFor(() =>
      expect(world.closest("li")?.textContent).toContain("désactivée"),
    );
    expect(
      within(section).queryByRole("link", { name: "octocat/old" }),
    ).toBeNull();
  });

  it("given a routine that is not connected, when the section loads, then no project is listed", async () => {
    stubApi({ routine: NOT_CONNECTED, projects: PROJECTS });

    renderAt("/reglages/taches-cloud");

    const section = await loadedSection();
    expect(
      within(section).queryByRole("link", { name: "octocat/hello" }),
    ).toBeNull();
  });
});

// Decision 085 / audit: Retirer asks for a confirmation in place (003 rule 4), focus on Annuler.
describe("Réglages page, Retirer a connected task asks to confirm", () => {
  it("given a connected routine, when Retirer is clicked, then nothing is sent, the warning and the buttons Confirmer le retrait and Annuler show, and the focus is on Annuler", async () => {
    const calls = stubApi({ routine: CONNECTED });
    renderAt("/reglages/taches-cloud");
    const section = await loadedSection();

    fireEvent.click(
      await within(section).findByRole("button", { name: "Retirer" }),
    );

    expect(section.textContent).toContain("Retirer la tâche ?");
    expect(section.textContent).toContain("régénérer son jeton sur claude.ai");
    expect(
      within(section).getByRole("button", { name: "Confirmer le retrait" }),
    ).toBeDefined();
    expect(document.activeElement).toBe(
      within(section).getByRole("button", { name: "Annuler" }),
    );
    expect(writes(calls)).toHaveLength(0);
  });

  it("given the confirmation is shown, when Annuler is clicked, then Retirer is back, Connectée stays and nothing was sent", async () => {
    const calls = stubApi({ routine: CONNECTED });
    renderAt("/reglages/taches-cloud");
    const section = await loadedSection();
    fireEvent.click(
      await within(section).findByRole("button", { name: "Retirer" }),
    );

    fireEvent.click(within(section).getByRole("button", { name: "Annuler" }));

    expect(
      within(section).getByRole("button", { name: "Retirer" }),
    ).toBeDefined();
    expect(within(section).getByText("Connectée")).toBeDefined();
    expect(writes(calls)).toHaveLength(0);
  });

  it("given the confirmation is shown, when Confirmer le retrait is clicked, then DELETE /api/me/routine is sent and the fields are offered again", async () => {
    const calls = stubApi({ routine: CONNECTED });
    renderAt("/reglages/taches-cloud");
    const section = await loadedSection();
    fireEvent.click(
      await within(section).findByRole("button", { name: "Retirer" }),
    );

    fireEvent.click(
      within(section).getByRole("button", { name: "Confirmer le retrait" }),
    );

    await waitFor(() =>
      expect(within(section).getByLabelText("Jeton")).toBeDefined(),
    );
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({
      method: "DELETE",
      path: "/api/me/routine",
    });
  });
});

describe("Journal page, the routine actions", () => {
  it("given the four routine actions, when /journal loads, then each row reads its French label and never the internal code", async () => {
    const entry = (id: number, action: string) => ({
      id,
      at: "2026-10-29T07:00:00.000Z",
      actor: "human",
      origin: "ui",
      action,
      result: "ok",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const raw =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(raw, "http://localhost").pathname;
        if (path === "/api/setup/status")
          return Response.json({
            configured: true,
            detectedUrl: "http://localhost",
          });
        if (path === "/api/me")
          return Response.json({
            login: "octocat",
            name: null,
            avatarUrl: null,
          });
        if (path === "/api/history")
          return Response.json({
            entries: [
              entry(1, "connect_routine"),
              entry(2, "disconnect_routine"),
              entry(3, "schedule_routine"),
              entry(4, "fire_write_us"),
            ],
          });
        throw new Error(`Unexpected fetch ${raw}`);
      }),
    );

    renderAt("/journal");

    await screen.findByText("Tâche d'écriture des US connectée");
    expect(screen.getByText("Tâche d'écriture des US retirée")).toBeDefined();
    expect(
      screen.getByText("Planning d'écriture des US modifié"),
    ).toBeDefined();
    expect(screen.getByText("Écriture des US lancée")).toBeDefined();
    expect(
      screen.queryByText(
        /connect_routine|disconnect_routine|schedule_routine|fire_write_us/,
      ),
    ).toBeNull();
  });
});
