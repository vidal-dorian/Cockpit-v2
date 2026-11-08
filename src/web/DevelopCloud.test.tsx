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
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// Slice 14.1 (decision 054 H): the target « Dans le cloud » of the panel « Développer avec Claude ».
//
// Pinned where the decision leaves it open (the developer follows these):
// - The two targets are radios (role radio) named « Dans le cloud » and « Sur ce PC, avec Claude Desktop » (the name may
//   contain the hint sentence after it). The cloud one is checked first when it is possible, the PC one otherwise.
// - The panel reads GET /api/me/launcher ({ connected, needsReconnect, prompt, projectIds }), the project (5) is ticked when
//   its id is in projectIds.
// - When the cloud is not possible, its radio is disabled and the panel shows a link to /reglages/taches-cloud
//   (role link) and a sentence that is not empty beside it.
// - In the cloud: no field « Dossier du clone », a button « Lancer dans le cloud » (Ctrl Entrée too), which POSTs
//   /api/stories/42/launch { branch, team?, comment? } (comment is the « Prompt complémentaire », absent when empty).
// - After the 201: « Lancé dans le cloud », and a link « Voir la session » to sessionUrl when it is not null.
// - A 409 or a 502 shows a role alert in French (never the code of the server) and a button « Réessayer ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const IWANT = "Me connecter avec GitHub";
const BRANCH = "us/42-me-connecter-avec-github";
const SESSION = "https://claude.ai/code/session_01ABCDEFGHIJ";

type Launcher = {
  connected: boolean;
  needsReconnect: boolean;
  projectIds: number[];
};
const READY: Launcher = {
  connected: true,
  needsReconnect: false,
  projectIds: [5],
};
type Options = {
  launcher?: Launcher;
  launch?: { status: number; body: unknown };
  teams?: { name: string; text: string }[];
  runUsd?: number | null;
};

function stub(options: Options = {}) {
  const base = story(42, 7, IWANT, { status: "ready" });
  stubTicketApi([ticket(7, "Idée")], [base]);
  const inner = globalThis.fetch;
  const posts: { path: string; body: Record<string, unknown> }[] = [];
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
      const method = (init?.method ?? "GET").toUpperCase();
      if (path === "/api/stories/42" && method === "GET") {
        const body = await (await inner(input, init)).json();
        body.story.branch = null;
        body.project.archived = false;
        return Response.json(body);
      }
      if (path === "/api/projects/5/branches")
        return Response.json({ branches: ["main"] });
      if (path === "/api/projects/5/agents")
        return Response.json({
          agents: [],
          catalog: [],
          team: null,
          teams: options.teams ?? [],
        });
      if (path === "/api/me/launcher" && method === "GET")
        return Response.json({
          prompt: "p",
          ...(options.launcher ?? READY),
        });
      if (path === "/api/me/budgets")
        return Response.json({
          runUsd: options.runUsd ?? null,
          nightUsd: null,
          monthUsd: null,
        });
      if (path === "/api/stories/42/launch" && method === "POST") {
        posts.push({ path, body: JSON.parse(String(init?.body)) });
        const answer = options.launch ?? {
          status: 201,
          body: { launchId: 9, sessionUrl: SESSION },
        };
        return Response.json(answer.body, { status: answer.status });
      }
      return inner(input, init);
    }),
  );
  return posts;
}

async function open(options: Options = {}) {
  const posts = stub(options);
  renderAt("/us/42");
  await waitFor(() =>
    expect(screen.getByRole("main").textContent).toContain(IWANT),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Développer avec Claude" }),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Développer avec Claude",
  });
  return { panel, posts, ui: within(panel) };
}
type Ui = ReturnType<typeof within>;
const cloudRadio = (ui: Ui) =>
  ui.findByRole("radio", {
    name: /Dans le cloud/,
  }) as Promise<HTMLInputElement>;
const pcRadio = (ui: Ui) =>
  ui.getByRole("radio", {
    name: /Sur ce PC, avec Claude Desktop/,
  }) as HTMLInputElement;

describe("criterion 8: the choice of the target", () => {
  it("given a connected launcher and a ticked project, when the panel opens, then « Dans le cloud » is first and selected, and « Sur ce PC, avec Claude Desktop » is the other choice", async () => {
    const { ui, panel } = await open();

    const cloud = await cloudRadio(ui);

    expect(cloud.checked).toBe(true);
    expect(cloud.disabled).toBe(false);
    expect(pcRadio(ui).checked).toBe(false);
    const radios = within(panel).getAllByRole("radio", {
      name: /Dans le cloud|Sur ce PC/,
    });
    expect(radios[0]).toBe(cloud);
    expect(panel.textContent).toContain(
      "Ton PC peut être éteint. Claude ouvre la PR et te prévient.",
    );
  });

  it("given the cloud target, when the panel is read, then there is no « Dossier du clone » field and the button is « Lancer dans le cloud » instead of « Lancer Claude »", async () => {
    const { ui } = await open();
    await cloudRadio(ui);

    expect(ui.queryByLabelText("Dossier du clone")).toBeNull();
    expect(
      ui.getByRole("button", { name: /Lancer dans le cloud/ }),
    ).toBeDefined();
    expect(ui.queryByText("Lancer Claude")).toBeNull();
  });

  it("given the cloud target, when the user picks « Sur ce PC », then the folder field and « Lancer Claude » are back, as before", async () => {
    const { ui } = await open();
    await cloudRadio(ui);

    fireEvent.click(pcRadio(ui));

    expect(ui.getByLabelText("Dossier du clone")).toBeDefined();
    expect(ui.getByText("Lancer Claude")).toBeDefined();
    expect(
      ui.queryByRole("button", { name: /Lancer dans le cloud/ }),
    ).toBeNull();
  });
});

describe("criterion 8: the launch in the cloud", () => {
  it("given the cloud target, a team and an extra prompt, when the user clicks « Lancer dans le cloud », then POST /api/stories/42/launch carries the branch, the team and the comment", async () => {
    const { ui, posts } = await open({
      teams: [{ name: "fast", text: "x" }],
    });
    await cloudRadio(ui);
    fireEvent.change(ui.getByLabelText("Équipe"), {
      target: { value: "fast" },
    });
    fireEvent.change(ui.getByLabelText("Prompt complémentaire"), {
      target: { value: "Fais attention au CSS" },
    });

    fireEvent.click(ui.getByRole("button", { name: /Lancer dans le cloud/ }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toEqual({
      branch: BRANCH,
      team: "fast",
      comment: "Fais attention au CSS",
    });
  });

  it("given a launch that worked, when the answer comes, then the panel says « Lancé dans le cloud » with a link « Voir la session » to the session", async () => {
    const { ui } = await open();
    await cloudRadio(ui);

    fireEvent.click(ui.getByRole("button", { name: /Lancer dans le cloud/ }));

    expect(await ui.findByText(/Lancé dans le cloud/)).toBeDefined();
    const link = ui.getByRole("link", { name: /Voir la session/ });
    expect(link.getAttribute("href")).toBe(SESSION);
  });

  it("given a launch that was sent, when Ctrl Entrée is pressed again, then nothing is sent twice", async () => {
    const { ui, posts } = await open();
    await cloudRadio(ui);
    const field = ui.getByLabelText("Prompt complémentaire");

    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await ui.findByText(/Lancé dans le cloud/);
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toHaveLength(1);
  });

  it.each([
    [409, { error: "launch_pending" }],
    [502, { error: "fire_failed" }],
  ])(
    "given the server answers %i %j, when the user launches, then a French error is shown without the code, with « Réessayer »",
    async (status, body) => {
      const { ui } = await open({ launch: { status, body } });
      await cloudRadio(ui);

      fireEvent.click(ui.getByRole("button", { name: /Lancer dans le cloud/ }));

      const alert = await ui.findByRole("alert");
      expect(alert.textContent?.trim().length).toBeGreaterThan(10);
      expect(alert.textContent).not.toContain(body.error);
      expect(ui.getByRole("button", { name: "Réessayer" })).toBeDefined();
      expect(ui.queryByText(/Lancé dans le cloud/)).toBeNull();
    },
  );
});

describe("criterion 8: when the cloud is not possible", () => {
  it.each([
    [
      "the launcher is not connected",
      { connected: false, needsReconnect: false, projectIds: [] },
    ],
    [
      "the launcher needs reconnecting",
      { connected: true, needsReconnect: true, projectIds: [5] },
    ],
    [
      "the project is not ticked",
      { connected: true, needsReconnect: false, projectIds: [] },
    ],
  ])(
    "given %s, when the panel opens, then « Dans le cloud » is disabled with a link to /reglages/taches-cloud, « Sur ce PC » is selected and « Lancer Claude » works as before",
    async (_name, launcher) => {
      const { ui } = await open({ launcher });

      const cloud = await cloudRadio(ui);

      expect(cloud.disabled).toBe(true);
      expect(pcRadio(ui).checked).toBe(true);
      const link = ui
        .getAllByRole("link")
        .find((a) => a.getAttribute("href") === "/reglages/taches-cloud");
      expect(link, "a link to /reglages/taches-cloud").toBeDefined();
      expect(link?.parentElement?.textContent?.trim().length).toBeGreaterThan(
        (link?.textContent?.length ?? 0) + 10,
      );
      expect(ui.getByLabelText("Dossier du clone")).toBeDefined();
      expect(ui.getByText("Lancer Claude")).toBeDefined();
      expect(
        ui.queryByRole("button", { name: /Lancer dans le cloud/ }),
      ).toBeNull();
    },
  );
});

// Slice 14.5 (decision 060 D): the field « Plafond », prefilled from GET /api/me/budgets (runUsd), sent as budgetUsd.
describe("criterion 14.5: the cap of the run", () => {
  it("given a run budget of 2.5, when the panel opens and the user sets 4, then « Plafond » was prefilled with 2.5 and the launch carries budgetUsd 4", async () => {
    const { ui, posts } = await open({ runUsd: 2.5 });
    await cloudRadio(ui);
    const field = (await ui.findByLabelText("Plafond")) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("2.5"));

    fireEvent.change(field, { target: { value: "4" } });
    fireEvent.click(ui.getByRole("button", { name: /Lancer dans le cloud/ }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toMatchObject({ branch: BRANCH, budgetUsd: 4 });
  });
});
