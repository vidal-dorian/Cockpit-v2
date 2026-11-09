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
import { writeTeam } from "./team-file.ts";
import { renderAt, story, stubTicketApi, ticket } from "./test-tickets.tsx";

// US C: « Développer avec Claude » warns when the repo copy of a team differs from the global team of « Équipes d'agents ».
//
// Pinned where the story leaves it open:
// - Same page and panel as DevelopWindow.test.tsx (story 42 of project 5, octocat/hello); the select is labelled « Équipe ».
// - The suffix is part of the option's accessible name: « leger · à mettre à jour ».
// - The warning is the element role="status" inside the panel that contains the sentence; the button « Mettre à jour dans le projet » is inside it.
// - « Same text » means strictly equal strings. The warning shows only once the global teams are loaded, for the selected team only; the suffix shows for every stale option.
// - After the update, the repo teams are read again (a second GET /api/projects/5/agents); the stub applies the posted `after` to the repo copy.
// - Launching stays the « Lancer Claude » link, still with its href.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const step = (agent: string) => ({
  agent,
  does: "does it",
  loopTo: null,
  until: "",
});
const teamOf = (...agents: string[]) => writeTeam(agents.map(step), "");
const T1 = teamOf("developer");
const T2 = teamOf("developer", "doc-writer");
const DOC_WRITER =
  "---\nname: doc-writer\ndescription: d\n---\nYou are doc-writer.\n";
const SHA = "a".repeat(40);
const WARNING =
  "L'équipe leger a changé dans Équipes d'agents depuis son ajout à ce projet. Claude suivra la version du repo tant que tu ne la mets pas à jour.";

type Options = {
  repo?: { name: string; text: string }[];
  global?: { id: number; name: string; text: string }[] | "fail";
  apply?: { status: number; body: unknown };
};

function stub(options: Options = {}) {
  const base = story(42, 7, "Me connecter avec GitHub", { status: "ready" });
  stubTicketApi([ticket(7, "Idée")], [base]);
  const inner = globalThis.fetch;
  const repo = (options.repo ?? [{ name: "leger", text: T1 }]).map((t) => ({
    ...t,
  }));
  const applies: Record<string, unknown>[] = [];
  const calls = { agentReads: 0 };
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
      if (path === "/api/projects/5/branches")
        return Response.json({ branches: ["main"] });
      if (path === "/api/projects/5/agents") {
        calls.agentReads++;
        return Response.json({
          agents: [
            { name: "developer", text: "---\nname: developer\n---\nx\n" },
          ],
          catalog: [],
          team: null,
          teams: repo,
        });
      }
      if (path === "/api/agent-teams")
        return options.global === "fail"
          ? Response.json({ error: "boom" }, { status: 500 })
          : Response.json({ teams: options.global ?? [] });
      if (path === "/api/starter-teams")
        return Response.json({
          teams: [
            {
              id: "standard",
              team: T1,
              agents: [{ name: "doc-writer", text: DOC_WRITER }],
            },
          ],
        });
      if (path === "/api/projects/5/team/apply" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        applies.push(body);
        const answer = options.apply ?? {
          status: 200,
          body: { commitSha: SHA },
        };
        if (answer.status === 200) {
          const at = repo.findIndex((t) => t.name === body.name);
          if (at >= 0) (repo[at] as { text: string }).text = body.after;
          else repo.push({ name: body.name, text: body.after });
        }
        return Response.json(answer.body, { status: answer.status });
      }
      return inner(input, init);
    }),
  );
  return { applies, calls };
}

async function open(options: Options = {}) {
  const spies = stub(options);
  renderAt("/us/42");
  await waitFor(() =>
    expect(screen.getByRole("main").textContent).toContain(
      "Me connecter avec GitHub",
    ),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Développer avec Claude" }),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Développer avec Claude",
  });
  const ui = within(panel);
  await ui.findByLabelText("Équipe");
  return { ...spies, panel, ui };
}

const pick = (ui: ReturnType<typeof within>, value: string) =>
  fireEvent.change(ui.getByLabelText("Équipe"), { target: { value } });
const STALE = [{ id: 1, name: "leger", text: T2 }];
const optionNames = (ui: ReturnType<typeof within>) =>
  ui.getAllByRole("option").map((o: HTMLElement) => o.textContent);

describe("criterion 1: the suffix", () => {
  it("given a repo team leger (T1) and a global team leger (T2), when the window opens, then the option reads « leger · à mettre à jour » with value leger", async () => {
    const { ui } = await open({ global: STALE });

    const option = (await ui.findByRole("option", {
      name: "leger · à mettre à jour",
    })) as HTMLOptionElement;
    expect(option.value).toBe("leger");
  });
});

describe("criterion 2: the warning", () => {
  it("given the same, when leger is picked, then a status (not an alert) shows the sentence and the button « Mettre à jour dans le projet »", async () => {
    const { ui } = await open({ global: STALE });
    await ui.findByRole("option", { name: "leger · à mettre à jour" });

    pick(ui, "leger");

    const status = await ui.findByRole("status");
    expect(status.textContent).toContain(WARNING);
    expect(
      within(status).getByRole("button", {
        name: "Mettre à jour dans le projet",
      }),
    ).toBeDefined();
    expect(ui.queryByRole("alert")).toBeNull();
  });
});

describe("criterion 3: the update", () => {
  it("given the warning, when the button is clicked, then team/apply gets { name, before: T1, after: T2, agents: [doc-writer] }, the repo is read again, the warning and the suffix go, and « C'est fait » is shown", async () => {
    const { ui, applies, calls } = await open({ global: STALE });
    await ui.findByRole("option", { name: "leger · à mettre à jour" });
    pick(ui, "leger");
    const reads = calls.agentReads;

    fireEvent.click(
      await ui.findByRole("button", { name: "Mettre à jour dans le projet" }),
    );

    await waitFor(() => expect(applies).toHaveLength(1));
    expect(applies[0]).toEqual({
      name: "leger",
      before: T1,
      after: T2,
      agents: [{ name: "doc-writer", before: null, after: DOC_WRITER }],
    });
    // One read by the update itself, one by the refetch of the window.
    await waitFor(() => expect(calls.agentReads).toBeGreaterThan(reads + 1));
    await waitFor(() => expect(optionNames(ui)).toContain("leger"));
    expect(ui.queryByText(/à mettre à jour/)).toBeNull();
    expect(ui.queryByText(/a changé dans Équipes d'agents/)).toBeNull();
    expect(await ui.findByText("C'est fait")).toBeDefined();
  });

  it("given the branch is protected, when the update is done, then the pull request sentence is shown", async () => {
    const { ui } = await open({
      global: STALE,
      apply: {
        status: 200,
        body: {
          commitSha: SHA,
          pullRequest: { url: "https://github.com/octocat/hello/pull/3" },
        },
      },
    });
    await ui.findByRole("option", { name: "leger · à mettre à jour" });
    pick(ui, "leger");

    fireEvent.click(
      await ui.findByRole("button", { name: "Mettre à jour dans le projet" }),
    );

    const link = await ui.findByRole("link", { name: "une pull request" });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/pull/3",
    );
  });

  it("given the server refuses the update, when the button is clicked, then an alert shows the refusal and the warning stays", async () => {
    const { ui } = await open({
      global: STALE,
      apply: { status: 502, body: { error: "github" } },
    });
    await ui.findByRole("option", { name: "leger · à mettre à jour" });
    pick(ui, "leger");

    fireEvent.click(
      await ui.findByRole("button", { name: "Mettre à jour dans le projet" }),
    );

    await ui.findByRole("alert");
    expect(ui.getByRole("status").textContent).toContain(WARNING);
  });
});

describe("criterion 4: the launch is never blocked", () => {
  it("given the warning shown, when the form is valid, then « Lancer Claude » is a link with a href", async () => {
    const { ui } = await open({ global: STALE });
    await ui.findByRole("option", { name: "leger · à mettre à jour" });
    pick(ui, "leger");
    await ui.findByRole("status");
    // The form is valid once the clone folder is known (PC mode, no launcher).
    fireEvent.change(ui.getByLabelText("Dossier du clone"), {
      target: { value: "/home/dorian/code/hello" },
    });

    const el = ui.getByText("Lancer Claude").closest("a, button");
    expect(el?.tagName).toBe("A");
    expect(el?.getAttribute("href")).toContain("claude://code/new");
    expect(el?.getAttribute("aria-disabled")).not.toBe("true");
  });
});

describe("criterion 5: nothing to warn about", () => {
  it.each([
    ["no global team of that name", [{ id: 1, name: "autre", text: T2 }]],
    ["the same text", [{ id: 1, name: "leger", text: T1 }]],
  ])(
    "given %s, when leger is picked, then no warning and no suffix",
    async (_label, global) => {
      const { ui } = await open({ global });
      await waitFor(() => expect(ui.getAllByRole("option").length).toBe(2));
      pick(ui, "leger");

      expect(ui.queryByRole("status")).toBeNull();
      expect(ui.queryByText(/à mettre à jour/)).toBeNull();
    },
  );

  it("given a stale team and the default team selected, then no warning (the suffix stays on leger only)", async () => {
    const { ui } = await open({
      repo: [{ name: "leger", text: T1 }],
      global: [
        { id: 1, name: "leger", text: T2 },
        { id: 2, name: "Par défaut", text: T2 },
      ],
    });
    await ui.findByRole("option", { name: "leger · à mettre à jour" });

    expect(ui.queryByRole("status")).toBeNull();
    expect(optionNames(ui)).toEqual(["Par défaut", "leger · à mettre à jour"]);
  });
});

describe("criterion 6: the global teams cannot be read", () => {
  it("given GET /api/agent-teams fails, when leger is picked, then no warning, no suffix, no error", async () => {
    const { ui, panel } = await open({ global: "fail" });
    await waitFor(() => expect(ui.getAllByRole("option").length).toBe(2));
    pick(ui, "leger");

    expect(ui.queryByRole("status")).toBeNull();
    expect(ui.queryByRole("alert")).toBeNull();
    expect(panel.textContent).not.toContain("à mettre à jour");
    expect(panel.textContent).not.toContain("Équipes d'agents");
  });
});
