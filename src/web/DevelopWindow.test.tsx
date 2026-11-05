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

// Slice 7.2 (decision 034): the panel « Développer avec Claude » of the story page (/us/:id), and the link of decision 005.
//
// Pinned where the decision leaves it open (the developer follows these):
// - GET /api/stories/:id gives story.branch (string | null); the project of the answer has `archived`. Story 42 of project 5 (octocat/hello).
// - The button is a role button named « Développer avec Claude ». The panel is a <section> labelled by its heading: role region, name « Développer avec Claude », and the heading (role heading, same name) gets the focus when it opens.
// - Within the panel: radios « Nouvelle branche » and « Branche existante » (role radio; absent when the story has a branch, which is then shown as text);
//   the text field « Nom de la branche »; the select « Branche existante » (role combobox, one option per branch, an empty placeholder option allowed);
//   the select « Équipe » (options « Par défaut » with value "" then one per team name); the text field « Dossier du clone »; the text field « Prompt complémentaire »;
//   the details « Pas encore cloné ? » (closed) that holds `git clone https://github.com/<full_name>.git`.
// - GET /api/projects/:id/branches and /agents are read when the panel opens ({ branches } and { agents, catalog, team, teams }). A failing branches call disables the radio « Branche existante » and shows a sentence containing « Impossible de lire les branches ».
// - Errors: « Nom de branche invalide » and a sentence containing « 10 000 » for the extra prompt. The limit is checked in the code, not with maxLength.
// - « Lancer Claude » is an <a href> when the form is valid; when it is not, the same element has no href or aria-disabled="true" (or is a disabled button). « Copier le prompt » is a button.
// - A dependency that is not done shows its iWant and its French status of STORY_STATUSES (« en cours »); a done one is not listed.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const IWANT = "Me connecter avec GitHub";
const BRANCH = "us/42-me-connecter-avec-github";
const FOLDER = "/home/dorian/code/hello";
const WINDOWS = "C:\\Users\\dorian\\code\\repo";
const MESSAGE = `/dev-us 42 --branch ${BRANCH}`;
const link = (folder: string, message: string) =>
  `claude://code/new?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(message)}`;

type Options = {
  status?: string;
  iWant?: string;
  branch?: string | null;
  archived?: boolean;
  branches?: string[] | "fail";
  teams?: { name: string; text: string }[];
  dependsOn?: { id: number; iWant: string; status: string }[];
};

function stub(options: Options = {}) {
  const base = story(42, 7, options.iWant ?? IWANT, {
    status: options.status ?? "ready",
    dependsOn: options.dependsOn ?? [],
  });
  stubTicketApi([ticket(7, "Idée")], [base]);
  const inner = globalThis.fetch;
  const paths: string[] = [];
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
      paths.push(path);
      if (path === "/api/stories/42") {
        const body = await (await inner(input, init)).json();
        body.story.branch = options.branch ?? null;
        body.project.archived = options.archived ?? false;
        return Response.json(body);
      }
      if (path === "/api/projects/5/branches")
        return options.branches === "fail"
          ? Response.json({ error: "github" }, { status: 502 })
          : Response.json({ branches: options.branches ?? ["main"] });
      if (path === "/api/projects/5/agents")
        return Response.json({
          agents: [],
          catalog: [],
          team: null,
          teams: options.teams ?? [],
        });
      return inner(input, init);
    }),
  );
  return paths;
}

const loaded = (iWant = IWANT) =>
  waitFor(() => expect(screen.getByRole("main").textContent).toContain(iWant));
const openButton = () =>
  screen.queryByRole("button", { name: "Développer avec Claude" });

async function open(options: Options = {}) {
  const paths = stub(options);
  renderAt("/us/42");
  await loaded(options.iWant);
  fireEvent.click(
    await screen.findByRole("button", { name: "Développer avec Claude" }),
  );
  const panel = await screen.findByRole("region", {
    name: "Développer avec Claude",
  });
  return { panel, paths, ui: within(panel) };
}

/** The « Lancer Claude » element, enabled when it is a link that has a href. */
const launch = (panel: HTMLElement) => {
  const el = within(panel).getByText("Lancer Claude").closest("a, button");
  if (!el) throw new Error("no « Lancer Claude » link or button");
  const disabled =
    el.getAttribute("aria-disabled") === "true" ||
    (el as HTMLButtonElement).disabled === true ||
    (el.tagName === "A" && !el.getAttribute("href"));
  return { el, disabled, href: el.getAttribute("href") };
};
const type = (el: HTMLElement, value: string) =>
  fireEvent.change(el, { target: { value } });
const folderField = (ui: ReturnType<typeof within>) =>
  ui.getByLabelText("Dossier du clone") as HTMLInputElement;
const nameField = (ui: ReturnType<typeof within>) =>
  ui.getByLabelText("Nom de la branche") as HTMLInputElement;

describe("criterion 1: the button", () => {
  it("given a ready story of an active project, when /us/42 loads, then the button « Développer avec Claude » is shown", async () => {
    stub();
    renderAt("/us/42");
    await loaded();

    expect(
      await screen.findByRole("button", { name: "Développer avec Claude" }),
    ).toBeDefined();
  });

  it.each([
    "to_validate",
    "to_rewrite",
    "in_progress",
    "in_review",
    "done",
    "abandoned",
  ])(
    "given a story %s, when /us/42 loads, then there is no button « Développer avec Claude »",
    async (status) => {
      stub({ status });
      renderAt("/us/42");
      await loaded();

      expect(openButton()).toBeNull();
    },
  );

  it("given a ready story of an archived project, when /us/42 loads, then there is no button", async () => {
    stub({ archived: true });
    renderAt("/us/42");
    await loaded();

    expect(openButton()).toBeNull();
  });
});

describe("criterion 2: the panel", () => {
  it("given the button, when it is clicked, then the panel opens with its heading focused, and « Annuler » closes it", async () => {
    const { panel, ui } = await open();

    const heading = ui.getByRole("heading", { name: "Développer avec Claude" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fireEvent.click(ui.getByRole("button", { name: "Annuler" }));

    expect(panel.isConnected).toBe(false);
    expect(
      screen.queryByRole("region", { name: "Développer avec Claude" }),
    ).toBeNull();
  });

  it("given the panel, when it opens, then it comes before the story text in the page", async () => {
    const { panel } = await open();

    const text = screen.getByText(/Afin de/);
    expect(
      panel.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("criterion 3: a new branch", () => {
  it("given a story 42 without branch, when the panel opens, then « Nouvelle branche » is selected with the name us/42-me-connecter-avec-github, editable", async () => {
    const { ui } = await open();

    expect(
      (ui.getByRole("radio", { name: "Nouvelle branche" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(nameField(ui).value).toBe(BRANCH);
    type(nameField(ui), "us/42-autre");
    expect(nameField(ui).value).toBe("us/42-autre");
  });

  it.each([
    ["Éditer les équipes à la volée", "us/42-editer-les-equipes-a-la-volee"],
    [
      "Consulter lhistorique complet des executions de chaque equipe du projet",
      "us/42-consulter-lhistorique-complet-des-execut",
    ],
  ])(
    "given the i_want %s, when the panel opens, then the proposed name is %s (lower case, no accents, dashes, 40 characters at most)",
    async (iWant, expected) => {
      const { ui } = await open({ iWant });

      expect(nameField(ui).value).toBe(expected);
    },
  );

  it.each(["a b", "-x", "a..b", "x/"])(
    "given the name %s, when it is typed, then « Nom de branche invalide » is shown and « Lancer Claude » is disabled",
    async (name) => {
      const { panel, ui } = await open();
      type(folderField(ui), FOLDER);
      expect(launch(panel).disabled).toBe(false);

      type(nameField(ui), name);

      expect(ui.getByText(/Nom de branche invalide/)).toBeDefined();
      expect(launch(panel).disabled).toBe(true);
    },
  );
});

describe("criterion 4: an existing branch", () => {
  it("given branches main and us/1-x, when « Branche existante » is chosen, then the select lists them and the choice goes into the message", async () => {
    const { panel, ui } = await open({ branches: ["main", "us/1-x"] });
    type(folderField(ui), FOLDER);

    fireEvent.click(ui.getByRole("radio", { name: "Branche existante" }));

    const select = ui.getByRole("combobox", {
      name: "Branche existante",
    }) as HTMLSelectElement;
    const options = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== "");
    expect(options).toEqual(["main", "us/1-x"]);
    type(select, "us/1-x");
    expect(launch(panel).href).toBe(link(FOLDER, "/dev-us 42 --branch us/1-x"));
  });

  it("given the branches call fails, when the panel opens, then « Branche existante » is disabled with a sentence saying why, and a new branch still works", async () => {
    const { panel, ui } = await open({ branches: "fail" });

    await waitFor(() =>
      expect(
        (
          ui.getByRole("radio", {
            name: "Branche existante",
          }) as HTMLInputElement
        ).disabled,
      ).toBe(true),
    );
    expect(ui.getByText(/Impossible de lire les branches/)).toBeDefined();
    type(folderField(ui), FOLDER);
    expect(launch(panel).href).toBe(link(FOLDER, MESSAGE));
  });
});

describe("criterion 5: a story that already has a branch", () => {
  it("given a story on the branch us/42-first, when the panel opens, then the branch is shown without radio or name field and goes into the message", async () => {
    const { panel, ui } = await open({ branch: "us/42-first" });
    type(folderField(ui), FOLDER);

    expect(ui.getByText("us/42-first")).toBeDefined();
    expect(ui.queryAllByRole("radio")).toEqual([]);
    expect(ui.queryByLabelText("Nom de la branche")).toBeNull();
    expect(launch(panel).href).toBe(
      link(FOLDER, "/dev-us 42 --branch us/42-first"),
    );
  });
});

describe("criterion 6: the team", () => {
  it("given a named team leger, when the panel opens, then « Équipe » offers « Par défaut » and « leger », and choosing leger adds --team leger", async () => {
    const { panel, ui } = await open({
      teams: [{ name: "leger", text: "x" }],
    });
    type(folderField(ui), FOLDER);

    const select = (await ui.findByRole("combobox", {
      name: "Équipe",
    })) as HTMLSelectElement;
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => [(o as HTMLOptionElement).value, o.textContent]),
    ).toEqual([
      ["", "Par défaut"],
      ["leger", "leger"],
    ]);
    expect(launch(panel).href).toBe(link(FOLDER, MESSAGE));
    type(select, "leger");

    expect(launch(panel).href).toBe(link(FOLDER, `${MESSAGE} --team leger`));
  });

  it("given no named team, when the panel opens and the agents are read, then there is no « Équipe » select", async () => {
    const { ui, paths } = await open({ teams: [] });

    await waitFor(() => expect(paths).toContain("/api/projects/5/agents"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ui.queryByRole("combobox", { name: "Équipe" })).toBeNull();
  });
});

describe("criterion 7: the clone folder", () => {
  it("given no folder, when the panel opens, then the field is empty and « Lancer Claude » is disabled", async () => {
    const { panel, ui } = await open();

    expect(folderField(ui).value).toBe("");
    expect(launch(panel).disabled).toBe(true);
    type(folderField(ui), FOLDER);
    expect(launch(panel).disabled).toBe(false);
  });

  it("given cockpit.clone.5 in localStorage, when the panel opens, then the field is prefilled", async () => {
    window.localStorage.setItem("cockpit.clone.5", FOLDER);

    const { panel, ui } = await open();

    expect(folderField(ui).value).toBe(FOLDER);
    expect(launch(panel).disabled).toBe(false);
  });

  it("given a folder typed, when « Lancer Claude » is clicked, then it is saved under cockpit.clone.5", async () => {
    const { panel, ui } = await open();
    type(folderField(ui), WINDOWS);
    // jsdom cannot navigate to claude://: the click is only observed.
    document.addEventListener("click", (e) => e.preventDefault());

    fireEvent.click(launch(panel).el);

    expect(window.localStorage.getItem("cockpit.clone.5")).toBe(WINDOWS);
  });

  it("given a localStorage that throws, when the panel opens and the link is clicked, then the field is empty and nothing crashes", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { panel, ui } = await open();

    expect(folderField(ui).value).toBe("");
    type(folderField(ui), FOLDER);
    document.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(launch(panel).el);

    expect(
      screen.getByRole("region", { name: "Développer avec Claude" }),
    ).toBeDefined();
  });

  it("given the panel, when it opens, then « Pas encore cloné ? » is collapsed and holds git clone https://github.com/octocat/hello.git", async () => {
    const { ui } = await open();

    const summary = ui.getByText("Pas encore cloné ?");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent).toContain(
      "git clone https://github.com/octocat/hello.git",
    );
  });
});

describe("criterion 8: the extra prompt", () => {
  it("given 10 000 characters, when they are typed, then launching is allowed; with 10 001 an error is shown and it is disabled", async () => {
    const { panel, ui } = await open();
    type(folderField(ui), FOLDER);
    const field = ui.getByLabelText("Prompt complémentaire");

    type(field, "a".repeat(10_000));
    expect(launch(panel).disabled).toBe(false);
    expect(ui.queryByText(/10 000/)).toBeNull();
    type(field, "a".repeat(10_001));

    expect(ui.getByText(/10 000/)).toBeDefined();
    expect(launch(panel).disabled).toBe(true);
  });
});

describe("criterion 9: the reminders", () => {
  it("given a dependency in progress and one done, when the panel opens, then only the first is listed with its French status, with the mode and the sentence", async () => {
    const { ui } = await open({
      dependsOn: [
        { id: 20, iWant: "base non finie", status: "in_progress" },
        { id: 19, iWant: "base terminee", status: "done" },
      ],
    });

    const dependency = ui.getByText(/base non finie/).closest("li, p, div");
    expect(dependency?.textContent).toMatch(/en cours/);
    expect(ui.queryByText(/base terminee/)).toBeNull();
    expect(ui.getByText(/Accepter les modifications/)).toBeDefined();
    expect(
      ui.getByText(
        "Claude Desktop va s'ouvrir. Confirme le dossier, puis appuie sur Entrée.",
      ),
    ).toBeDefined();
  });
});

describe("criterion 10: the link", () => {
  it("given story 42, a folder and the proposed branch, when the panel is filled, then « Lancer Claude » is a link to claude://code/new with the encoded folder and message", async () => {
    const { panel, ui } = await open();

    type(folderField(ui), FOLDER);

    const { el, href, disabled } = launch(panel);
    expect(el.tagName).toBe("A");
    expect(disabled).toBe(false);
    expect(href).toBe(link(FOLDER, MESSAGE));
  });

  it("given a Windows folder, when it is typed, then it is encoded with encodeURIComponent", async () => {
    const { panel, ui } = await open();

    type(folderField(ui), WINDOWS);

    expect(launch(panel).href).toBe(link(WINDOWS, MESSAGE));
    expect(launch(panel).href).toContain("folder=C%3A%5CUsers%5Cdorian");
  });

  it("given an extra prompt and the team leger, when they are set, then the message is the command, an empty line, then the prompt", async () => {
    const { panel, ui } = await open({ teams: [{ name: "leger", text: "x" }] });
    type(folderField(ui), FOLDER);
    type(
      (await ui.findByRole("combobox", { name: "Équipe" })) as HTMLElement,
      "leger",
    );

    type(
      ui.getByLabelText("Prompt complémentaire"),
      "Fais attention & vérifie\nle CSS",
    );

    expect(launch(panel).href).toBe(
      link(
        FOLDER,
        `${MESSAGE} --team leger\n\nFais attention & vérifie\nle CSS`,
      ),
    );
  });
});

describe("criterion 11: copying the prompt", () => {
  it("given the filled panel, when « Copier le prompt » is clicked, then the message of the link is written to the clipboard and « Copié » is shown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { ui } = await open();
    type(folderField(ui), FOLDER);
    type(ui.getByLabelText("Prompt complémentaire"), "Plus de détails");

    fireEvent.click(ui.getByRole("button", { name: "Copier le prompt" }));

    await ui.findByText("Copié");
    expect(writeText).toHaveBeenCalledWith(`${MESSAGE}\n\nPlus de détails`);
  });
});
