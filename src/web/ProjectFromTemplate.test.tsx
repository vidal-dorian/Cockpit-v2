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

// Slice 12.5, decision 068, screen S20. The contract these tests assume:
//
// « Tous les projets » (/projets) has a link « Nouveau depuis un modèle » to /projets/nouveau.
// /projets/nouveau reads GET /api/templates:
//   { installed, installUrl, owners: string[], templates: [{ githubRepoId, fullName, defaultBranch, lines: { key, ok, detail }[] }],
//     permission: { repositoryCreation: boolean, installationUrl, appMissing?: true } }
// Its title is « Un nouveau projet, déjà prêt pour Claude. » then « Cockpit crée le repo à partir de ton modèle. »
// The form: textbox « Nom du repo » (the owner, with a « / », shown before it), textbox « Description », one radio per template (the first one chosen,
//   its name is the repo's name and its full name is shown), radios « Privé » (chosen) and « Public », an <aside> « Le bilan sera vert d'emblée » with the
//   health lines of the chosen template (labels as on the project page: « CLAUDE.md », « CI », ...; a red one is marked and followed by the warning and a link
//   « Gérer mes modèles » to /projets), the button « Créer le projet » and « Annuler ».
// After a name is typed the page reads GET /api/templates/name?owner=&name= -> { available } and says « Disponible. » or « Ce nom est déjà pris. »;
//   « Créer le projet » stays disabled until the name is available (and while permission.repositoryCreation is false).
// « Créer le projet » sends POST /api/projects/from-template { template: <fullName>, owner, name, description, private } and goes to the authorizeUrl it gets.
// Refusals: 409 { error: "name_taken" } -> « Ce nom est déjà pris. », 409 { error: "not_a_template" } -> « Ce repo n'est plus un modèle. », 502 -> an alert and « Réessayer ».
// The server sends the user back to /projets/nouveau?erreur=<code>[&raison=<text>], which the page shows in an alert:
//   demande-expiree -> « Recommence la création. », annulee -> « La création est annulée. », refusee -> « GitHub a refusé la création : <raison> »,
//   hors-installation -> « Le repo est créé. Ouvre-le à Cockpit sur GitHub, puis importe-le. » with a link to installUrl and a link « Importer » to /projets#importer.

const INSTALL_URL = "https://github.com/apps/cockpit-test/installations/new";
const INSTALLATION_URL = "https://github.com/settings/installations/77";
const SETTINGS_URL = "https://github.com/settings/apps/cockpit/permissions";
const NO_TEMPLATE =
  "Tu n'as pas encore de repo modèle. Coche « Template repository » dans les réglages d'un repo sur GitHub, puis reviens.";
const NO_PERMISSION =
  "Cockpit n'a pas encore le droit de créer des repos. Approuve la nouvelle permission sur GitHub.";
const NOT_GREEN =
  "Ce modèle n'est pas tout vert : prépare-le d'abord pour Claude.";

const line = (key: string, ok: boolean) => ({
  key,
  ok,
  detail: ok ? "ok" : "missing",
});
const web = {
  githubRepoId: 1,
  fullName: "octocat/modele-web",
  defaultBranch: "main",
  lines: [line("claude_md", true), line("ci", true)],
};
const api = {
  githubRepoId: 2,
  fullName: "octocat/modele-api",
  defaultBranch: "main",
  lines: [line("claude_md", true), line("ci", false)],
};

type Sent = { method: string; path: string; body: unknown };

/** A small fake server behind fetch; `templates` overrides what GET /api/templates answers, `taken` are the names GitHub has. */
function stubApi(
  options: {
    templates?: unknown[];
    permission?: Record<string, unknown>;
    taken?: string[];
    create?: Response;
  } = {},
) {
  const sent: Sent[] = [];
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
      const url = new URL(raw, "http://localhost");
      const text =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "";
      const answers: Record<string, unknown> = {
        "/api/setup/status": {
          configured: true,
          detectedUrl: "http://localhost",
        },
        "/api/me": { login: "octocat", name: null, avatarUrl: null },
        "/api/home": { forYou: [], claudeWorks: [], projects: [] },
        "/api/projects": { projects: [] },
        "/api/github/repositories": {
          installUrl: INSTALL_URL,
          installed: true,
          repositories: [],
        },
        "/api/templates": {
          installed: true,
          installUrl: INSTALL_URL,
          owners: ["octocat"],
          templates: options.templates ?? [web, api],
          permission: options.permission ?? {
            repositoryCreation: true,
            installationUrl: INSTALLATION_URL,
          },
        },
      };
      if (url.pathname === "/api/health")
        return Response.json({ status: "ok", version: "0.1.0" });
      if (url.pathname === "/api/templates/name")
        return Response.json({
          available: !(options.taken ?? []).includes(
            url.searchParams.get("name") as string,
          ),
        });
      if (method === "POST" && url.pathname === "/api/projects/from-template") {
        sent.push({
          method,
          path: url.pathname,
          body: JSON.parse(text),
        });
        return (
          options.create ??
          Response.json({
            authorizeUrl: "https://github.com/login/oauth/authorize?state=s",
          })
        );
      }
      if (url.pathname in answers) return Response.json(answers[url.pathname]);
      throw new Error(`Unexpected fetch ${method} ${raw}`);
    }),
  );
  return sent;
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const nameField = () => screen.findByRole("textbox", { name: "Nom du repo" });
const submit = () => screen.getByRole("button", { name: "Créer le projet" });
const asideOf = async () =>
  within(
    (await screen.findByText("Le bilan sera vert d'emblée")).closest(
      "aside",
    ) as HTMLElement,
  );

/** Types a name and waits until the page has judged it. */
async function typeName(name: string, verdict: string) {
  fireEvent.change(await nameField(), { target: { value: name } });
  await screen.findByText(verdict, {}, { timeout: 3000 });
}

describe("decision 068 A: the entry and the sentences", () => {
  it("given /projets, when it loads, then « Nouveau depuis un modèle » is a link to /projets/nouveau", async () => {
    stubApi();

    renderAt("/projets");

    const link = await screen.findByRole("link", {
      name: "Nouveau depuis un modèle",
    });
    expect(link.getAttribute("href")).toBe("/projets/nouveau");
  });

  it("given /projets/nouveau, when it loads, then the state sentences are the ones of the decision", async () => {
    stubApi();

    renderAt("/projets/nouveau");

    const title = await screen.findByRole("heading", { level: 1 });
    expect(title.textContent).toContain(
      "Un nouveau projet, déjà prêt pour Claude.",
    );
    expect(title.textContent).toContain(
      "Cockpit crée le repo à partir de ton modèle.",
    );
  });
});

describe("decision 068 B: no template", () => {
  it("given no template, when the page loads, then it says how to mark one and offers no form", async () => {
    stubApi({ templates: [] });

    renderAt("/projets/nouveau");

    expect(await screen.findByText(NO_TEMPLATE)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Créer le projet" }),
    ).toBeNull();
  });
});

describe("decision 068 C: the form", () => {
  it("given two templates, when the page loads, then it shows the owner, the name and description fields, a card per template with the first chosen, Privé chosen, and Annuler", async () => {
    stubApi();

    renderAt("/projets/nouveau");

    await nameField();
    expect(screen.getByText(/octocat\s*\/$/)).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeDefined();
    const first = screen.getByRole("radio", { name: /modele-web/ });
    expect((first as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole("radio", { name: /modele-api/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(screen.getByText("octocat/modele-web")).toBeDefined();
    expect(
      (screen.getByRole("radio", { name: "Privé" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.getByRole("radio", { name: "Public" })).toBeDefined();
    expect(screen.getByText("Annuler")).toBeDefined();
  });

  it("given an all green template and a red one, when each is chosen, then the aside shows its lines, and only the red one adds the warning and « Gérer mes modèles »", async () => {
    stubApi();
    renderAt("/projets/nouveau");

    const green = await asideOf();
    expect(green.getByText("CLAUDE.md")).toBeDefined();
    expect(green.getByText("CI")).toBeDefined();
    expect(screen.queryByText(NOT_GREEN)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /modele-api/ }));

    expect(await screen.findByText(NOT_GREEN)).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Gérer mes modèles" })
        .getAttribute("href"),
    ).toBe("/projets");
  });

  it("given a name typed, when GitHub has it free, then « Disponible. » shows and « Créer le projet » is enabled; before, it is disabled", async () => {
    stubApi();
    renderAt("/projets/nouveau");
    await nameField();
    expect((submit() as HTMLButtonElement).disabled).toBe(true);

    await typeName("planning-chantiers", "Disponible.");

    expect((submit() as HTMLButtonElement).disabled).toBe(false);
  });

  it("given a name GitHub already has, when it is typed, then « Ce nom est déjà pris. » shows and « Créer le projet » stays disabled", async () => {
    stubApi({ taken: ["planning-chantiers"] });
    renderAt("/projets/nouveau");

    await typeName("planning-chantiers", "Ce nom est déjà pris.");

    expect((submit() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("decision 068 D: creating", () => {
  it("given a free name, a description and Public, when « Créer le projet » is pressed, then the request carries the template, owner, name, description and visibility", async () => {
    const sent = stubApi();
    renderAt("/projets/nouveau");
    await typeName("planning-chantiers", "Disponible.");
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "Planning des équipes" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Public" }));

    fireEvent.click(submit());

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({
      template: "octocat/modele-web",
      owner: "octocat",
      name: "planning-chantiers",
      description: "Planning des équipes",
      private: false,
    });
  });
});

describe("decision 068 F: the permission", () => {
  it.each([
    ["the installation has not approved it", INSTALLATION_URL, {}],
    ["the App lacks it", SETTINGS_URL, { appMissing: true }],
  ])(
    "given %s, when the page loads, then « Créer le projet » is disabled and the sentence links to the page to fix it",
    async (_name, href, extra) => {
      stubApi({
        permission: {
          repositoryCreation: false,
          installationUrl: href,
          ...extra,
        },
      });
      renderAt("/projets/nouveau");

      await typeName("planning-chantiers", "Disponible.");

      expect((submit() as HTMLButtonElement).disabled).toBe(true);
      const sentence = screen.getByText(NO_PERMISSION, { exact: false });
      expect(
        within(sentence.parentElement as HTMLElement)
          .getAllByRole("link")
          .some((a) => a.getAttribute("href") === href),
      ).toBe(true);
    },
  );
});

describe("decision 068 F and G: the refusals, in French next to the button", () => {
  it.each([
    [
      "name_taken",
      Response.json({ error: "name_taken" }, { status: 409 }),
      "Ce nom est déjà pris.",
    ],
    [
      "not_a_template",
      Response.json({ error: "not_a_template" }, { status: 409 }),
      "Ce repo n'est plus un modèle.",
    ],
  ])(
    "given the server answering 409 %s, when the creation is asked, then the page says so",
    async (_name, create, words) => {
      stubApi({ create });
      renderAt("/projets/nouveau");
      await typeName("planning-chantiers", "Disponible.");

      fireEvent.click(submit());

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(words);
    },
  );

  it("given GitHub unreachable (502), when the creation is asked, then an alert and « Réessayer » show", async () => {
    stubApi({
      create: Response.json({ error: "github_unavailable" }, { status: 502 }),
    });
    renderAt("/projets/nouveau");
    await typeName("planning-chantiers", "Disponible.");

    fireEvent.click(submit());

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeDefined();
  });

  it.each([
    ["?erreur=demande-expiree", "Recommence la création."],
    ["?erreur=annulee", "La création est annulée."],
    [
      "?erreur=github-injoignable",
      "GitHub ne répond pas comme prévu, réessaie dans un instant.",
    ],
    [
      "?erreur=creee-non-importee",
      "Le repo est peut-être créé sur GitHub ; importe-le depuis « Importer un repo ».",
    ],
    [
      "?erreur=refusee&raison=Resource%20not%20accessible",
      "GitHub a refusé la création : Resource not accessible",
    ],
  ])(
    "given the return %s, when the page loads, then an alert says %s",
    async (query, words) => {
      stubApi();

      renderAt(`/projets/nouveau${query}`);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(words);
      if (query.includes("injoignable"))
        expect(screen.getByRole("button", { name: "Réessayer" })).toBeDefined();
    },
  );

  it("given the repo created outside the installation (decision 068 E), when the page loads, then it says so with the installation link and the import link", async () => {
    stubApi();

    renderAt("/projets/nouveau?erreur=hors-installation");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Le repo est créé. Ouvre-le à Cockpit sur GitHub, puis importe-le.",
    );
    const hrefs = within(alert)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(INSTALL_URL);
    expect(hrefs).toContain("/projets#importer");
  });
});
