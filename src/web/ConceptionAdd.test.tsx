// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT,
  COMMIT,
  plan,
  SKILL,
  stubConception,
  WRITE_US,
} from "./test-conception.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R1 (decision 043 M): « Ajouter /analyser au repo », in the window of « Analyser avec Claude », for a repo that is already prepared and has neither file.
//
// Pinned where the decision leaves it open (the developer follows these):
// - It reuses the routes of 027, no new one: when the window opens, POST /api/projects/5/prepare is read (not at the page load) and the window keeps the two files
//   `.claude/skills/analyser/SKILL.md` and `.claude/agents/cartographer.md` of the plan (the other files of the plan are not shown).
// - Each of the two is a list item holding its path and the label of ProjectPrepare (« Sera ajouté », « Déjà là, identique », « Déjà là, différent : laissé tel quel » with the diff
//   of the current text, a removed line holding « Retirée », an added one « Ajoutée »).
// - The button « Ajouter /analyser au repo » is shown when at least one of the two is `create`; it sends POST /api/projects/5/prepare/apply with { plan } where plan is the one
//   received, untouched (baseSha, signature), reduced to the two files (statuses and texts as received, the plan order). 200 { commitSha }: « C'est fait » and a link to
//   https://github.com/octocat/hello/commit/<sha>. 409 repo_changed: an alert « Le repo a changé entre-temps : regarde de nouveau », never the code.
// - A plan that cannot be read does not break the window: « Ouvrir Claude » stays, with no proposal.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

async function openWindow(options: Parameters<typeof stubConception>[0] = {}) {
  const api = stubConception(options);
  renderAt("/projets/5/conception");
  const before = api.posts("/api/projects/5/prepare").length;
  expect(
    before,
    "the plan is read when the window opens, not at the page load",
  ).toBe(0);
  fireEvent.click(
    await screen.findByRole("button", { name: "Analyser avec Claude" }),
  );
  const panel = await screen.findByRole("complementary", {
    name: "Analyser avec Claude",
  });
  return { api, panel, ui: within(panel) };
}
const add = (ui: ReturnType<typeof within>) =>
  ui.findByRole("button", { name: "Ajouter /analyser au repo" });

describe("decision 043 M: the proposal for a repo that has neither file", () => {
  it("given a prepared repo without /analyser, when the window opens, then the plan is read once, the two files are listed as « Sera ajouté », the other files of the plan are not, and the button is offered", async () => {
    const { api, panel, ui } = await openWindow();

    await add(ui);

    expect(api.posts("/api/projects/5/prepare")).toHaveLength(1);
    const items = within(panel).getAllByRole("listitem");
    const skill = items.find((li) => li.textContent?.includes(SKILL));
    const agent = items.find((li) => li.textContent?.includes(AGENT));
    expect(skill?.textContent).toContain("Sera ajouté");
    expect(agent?.textContent).toContain("Sera ajouté");
    expect(panel.textContent).not.toContain(WRITE_US);
  });

  it("given the proposal, when « Ajouter /analyser au repo » is clicked, then the apply route gets the plan untouched, reduced to the two files, and the window says « C'est fait » with the link to the commit", async () => {
    const { api, panel, ui } = await openWindow();

    fireEvent.click(await add(ui));

    await waitFor(() => expect(panel.textContent).toContain("C'est fait"));
    const sent = api.posts("/api/projects/5/prepare/apply");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({
      plan: {
        baseSha: "d".repeat(40),
        signature: "signed-by-the-server",
        files: [
          { path: SKILL, content: "TEXTE-DU-SKILL", status: "create" },
          { path: AGENT, content: "TEXTE-DE-L-AGENT", status: "create" },
        ],
      },
    });
    const link = within(panel).getByRole("link", { name: /commit|c{7}/i });
    expect(link.getAttribute("href")).toBe(
      `https://github.com/octocat/hello/commit/${COMMIT}`,
    );
  });

  it("given a skill to create and an agent of the repo that differs, when the window opens, then the agent is « Déjà là, différent : laissé tel quel » with its diff, the button is offered, and both paths are sent as received", async () => {
    const { api, panel, ui } = await openWindow({
      prepare: {
        status: 200,
        body: {
          plan: plan([
            { path: SKILL, content: "TEXTE-DU-SKILL", status: "create" },
            {
              path: AGENT,
              content: "ligne un\nligne 2 du catalogue",
              status: "exists",
              current: "ligne un\nligne deux à moi",
            },
          ]),
        },
      },
    });

    fireEvent.click(await add(ui));

    const agent = within(panel)
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes(AGENT));
    expect(agent?.textContent).toContain(
      "Déjà là, différent : laissé tel quel",
    );
    expect(agent?.textContent).toContain("Retirée");
    expect(agent?.textContent).toContain("Ajoutée");
    await waitFor(() =>
      expect(api.posts("/api/projects/5/prepare/apply")).toHaveLength(1),
    );
    const body = api.posts("/api/projects/5/prepare/apply")[0]?.body as {
      plan: { files: { path: string; status: string; current?: string }[] };
    };
    expect(body.plan.files.map((f) => [f.path, f.status])).toEqual([
      [SKILL, "create"],
      [AGENT, "exists"],
    ]);
  });

  it("given a repo that already has both files, identical, when the window opens, then they are shown as « Déjà là, identique » and there is no « Ajouter /analyser au repo »", async () => {
    const { api, panel } = await openWindow({
      prepare: {
        status: 200,
        body: {
          plan: plan([
            { path: SKILL, content: "TEXTE-DU-SKILL", status: "same" },
            { path: AGENT, content: "TEXTE-DE-L-AGENT", status: "same" },
          ]),
        },
      },
    });

    await waitFor(() =>
      expect(api.posts("/api/projects/5/prepare")).toHaveLength(1),
    );
    await settle();
    expect(
      screen.queryByRole("button", { name: "Ajouter /analyser au repo" }),
    ).toBeNull();
    expect(panel.textContent).not.toContain("Ajouter /analyser au repo");
  });

  it("given a repo that has both files but different, when the window opens, then nothing is proposed (an existing file is never overwritten)", async () => {
    const { api, ui } = await openWindow({
      prepare: {
        status: 200,
        body: {
          plan: plan([
            {
              path: SKILL,
              content: "catalogue",
              status: "exists",
              current: "à moi",
            },
            {
              path: AGENT,
              content: "catalogue",
              status: "exists",
              current: "à moi aussi",
            },
          ]),
        },
      },
    });

    await waitFor(() =>
      expect(api.posts("/api/projects/5/prepare")).toHaveLength(1),
    );
    await settle();
    expect(
      ui.queryByRole("button", { name: "Ajouter /analyser au repo" }),
    ).toBeNull();
  });

  it("given the repo changing between the plan and the commit (409 repo_changed), when the button is clicked, then an alert in French says so, without the code", async () => {
    const { panel, ui } = await openWindow({
      apply: { status: 409, body: { error: "repo_changed" } },
    });

    fireEvent.click(await add(ui));

    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toContain(
      "Le repo a changé entre-temps : regarde de nouveau",
    );
    expect(alert.textContent).not.toContain("repo_changed");
  });

  it("given a plan that cannot be read (502), when the window opens, then « Ouvrir Claude » is still there and nothing is proposed", async () => {
    const { api, ui } = await openWindow({
      prepare: { status: 502, body: { error: "github_unavailable" } },
    });

    await waitFor(() =>
      expect(api.posts("/api/projects/5/prepare")).toHaveLength(1),
    );
    await settle();
    expect(ui.getByText("Ouvrir Claude")).toBeDefined();
    expect(
      ui.queryByRole("button", { name: "Ajouter /analyser au repo" }),
    ).toBeNull();
  });
});
