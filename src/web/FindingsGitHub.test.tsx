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
import {
  alert,
  type FakeFinding,
  finding,
  REFRESHED,
  stubFindings,
} from "./test-findings.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R6 (decision 052 F, H; screen S44): the findings of GitHub on the screen of the findings at /projets/:id/conception/constats.
//
// Pinned where the decision leaves it open (the developer follows these; the server answers as pinned in src/web/test-findings.tsx):
// - « Actualiser » is a button of the screen (name exactly « Actualiser »), before the filters. A click posts /api/projects/5/findings/refresh (no body) once, then the findings are read again.
//   On an archived project it is disabled. A refusal or a failure (409, 502...) is an alert in French (never the code, never the stub text) and the list stays.
// - A finding of GitHub says where it comes from instead of its kind word: « dépendance · GitHub » (githubAlertType dependabot), « faille · GitHub » (code_scanning), « secret · GitHub »
//   (secret_scanning), in the row of « Les autres constats » (with its severity word) and in the line of the first card (with the severity word too). They are of kind security, so they count among the failles.
// - After a refresh, the gray lines are elements with role="status", one per thing to say, none before a refresh and none when every tool is ok and `access` is null:
//   * for `access.detail` app_missing_permissions: a sentence that tells what to tick in « Permissions & events » of the App (the words « Permissions & events », « Dependabot alerts »,
//     « Code scanning alerts » and « Secret scanning alerts ») and a link named « Modifier l'App sur GitHub ↗ » to `access.url`;
//   * for installation_not_approved: « GitHub attend ton accord pour les nouvelles permissions de l'App » and a link « Approuver sur GitHub ↗ » to `access.url`
//     (the same sentences and links as the line of the health tab, src/web/ProjectPageAlerts.test.tsx);
//   * for each tool `disabled`: « Dependabot n'est pas activé sur ce repo. », « Code scanning n'est pas activé sur ce repo. » or « Secret scanning n'est pas activé sur ce repo. ».
// - A finding closed on GitHub (githubClosedAt set) is not to decide: it leaves « Tous », the filters of its kind, the sentence of the h1 and the number of the chip « Constats · N »; the filter
//   « Rejetés » shows it next to the dismissed ones, its row saying « fermée sur GitHub ». Its panel is read-only (no decision, no field of reason) and says « Fermée sur GitHub ».
// - The panel of a finding of GitHub has the link « Voir l'alerte sur GitHub ↗ » to `githubUrl` (never for a finding of Claude), and no code (a Dependabot finding cites no line).
// - A finding of kind `upgrade` (filed by Claude, decision 052 K) is a finding like another: in « Tous » and in « Versions », its kind word is « mise à jour ».

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

const PATH = "/projets/5/conception/constats";
const GROUP = "Filtrer les constats";
const main = () => screen.getByRole("main");
const inPanel = () => within(panel());
const open = async (
  list: FakeFinding[],
  options: Parameters<typeof stubFindings>[1] = {},
) => {
  const api = stubFindings(list, options);
  renderAt(PATH);
  await screen.findByRole("link", { name: /^Constats · \d+$/ });
  return api;
};
const h1 = () => screen.getByRole("heading", { level: 1 }).textContent ?? "";
const featured = () =>
  screen.getByText("1 · À corriger d'abord").closest("section") as HTMLElement;
const others = () =>
  screen.getByText("Les autres constats").closest("section") as HTMLElement;
const rowOf = (title: string) =>
  within(others())
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(title)) as HTMLElement;
const filter = (name: string) =>
  within(screen.getByRole("group", { name: GROUP })).getByRole("button", {
    name,
  });
const openFinding = (title: string) =>
  fireEvent.click(
    within(main()).getByRole("button", { name: `Ouvrir ${title}` }),
  );
const shown = (title: string) =>
  within(main()).queryByRole("button", { name: `Ouvrir ${title}` }) !== null;
const refreshButton = () =>
  screen.getByRole("button", { name: "Actualiser" }) as HTMLButtonElement;
const grayLines = () =>
  screen.queryAllByRole("status").map((el) => el.textContent ?? "");

describe("decision 052 H: « Actualiser »", () => {
  it("given the screen, when it opens, then the button « Actualiser » is there, enabled, before the filters, and nothing was refreshed", async () => {
    const api = await open([finding(1)]);

    const button = refreshButton();
    expect(button.disabled).toBe(false);
    const group = screen.getByRole("group", { name: GROUP });
    expect(
      button.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(api.refreshes()).toEqual([]);
    expect(grayLines()).toEqual([]);
  });

  it("given the button, when it is clicked, then one POST refresh is sent, the findings are read again and the new ones appear with the count", async () => {
    const api = await open(
      [alert(1, "dependabot", { title: "vendor/a : un" })],
      {
        onRefresh: (list) =>
          list.push(
            alert(2, "code_scanning", {
              title: "Injection SQL",
              severity: "high",
            }),
          ),
      },
    );
    const reads = () =>
      api.calls.filter(
        (c) => c.method === "GET" && c.path === "/api/projects/5/findings",
      ).length;
    const before = reads();

    fireEvent.click(refreshButton());

    await waitFor(() => expect(shown("Injection SQL")).toBe(true));
    expect(api.refreshes()).toHaveLength(1);
    expect(reads()).toBeGreaterThan(before);
    expect(h1()).toContain("2 constats sur hello, dont 2 failles.");
    expect(
      within(main()).getByRole("link", { name: "Constats · 2" }),
    ).toBeDefined();
    expect(grayLines()).toEqual([]);
  });

  it("given an archived project, when the screen opens, then « Actualiser » is disabled", async () => {
    await open([finding(1)], { archived: true });

    expect(refreshButton().disabled).toBe(true);
  });

  it.each([409, 502])(
    "given the server answering %s to the refresh, when the button is clicked, then an alert in French without the code is shown and the list stays",
    async (status) => {
      await open([finding(1)], {
        refresh: { status, body: { error: "stub failure" } },
      });

      fireEvent.click(refreshButton());

      const box = await screen.findByRole("alert");
      expect((box.textContent ?? "").trim().length).toBeGreaterThan(10);
      expect(box.textContent).not.toContain("stub failure");
      expect(shown("Constat numéro 1")).toBe(true);
    },
  );
});

describe("decision 052 H: the gray lines after a refresh", () => {
  const answer = (over: Partial<typeof REFRESHED>) => ({
    status: 200,
    body: { ...REFRESHED, ...over },
  });

  it("given a refresh where every tool is ok, when it is done, then no gray line is shown", async () => {
    const api = await open([finding(1)], { refresh: answer({}) });

    fireEvent.click(refreshButton());

    await waitFor(() => expect(api.refreshes()).toHaveLength(1));
    expect(grayLines()).toEqual([]);
  });

  it("given a refresh that says the installation did not approve the permissions, when it is done, then a gray line says GitHub waits for the agreement, with the link « Approuver sur GitHub ↗ »", async () => {
    const url = "https://github.com/settings/installations/77";
    await open([finding(1)], {
      refresh: answer({
        tools: {
          dependabot: "no_permission",
          code_scanning: "no_permission",
          secret_scanning: "no_permission",
        },
        access: { detail: "installation_not_approved", url },
      }),
    });

    fireEvent.click(refreshButton());

    await waitFor(() => expect(grayLines().length).toBeGreaterThan(0));
    expect(grayLines().join(" ")).toContain(
      "GitHub attend ton accord pour les nouvelles permissions de l'App",
    );
    const link = screen.getByRole("link", { name: "Approuver sur GitHub ↗" });
    expect(link.getAttribute("href")).toBe(url);
    expect(grayLines().join(" ")).not.toMatch(/installation_not_approved/);
  });

  it("given a refresh that says the App does not ask for the permissions, when it is done, then a gray line says what to tick in « Permissions & events », with the link « Modifier l'App sur GitHub ↗ »", async () => {
    const url = "https://github.com/settings/apps/cockpit-test/permissions";
    await open([finding(1)], {
      refresh: answer({
        tools: {
          dependabot: "no_permission",
          code_scanning: "ok",
          secret_scanning: "ok",
        },
        access: { detail: "app_missing_permissions", url },
      }),
    });

    fireEvent.click(refreshButton());

    await waitFor(() => expect(grayLines().length).toBeGreaterThan(0));
    const said = grayLines().join(" ");
    for (const word of [
      "Permissions & events",
      "Dependabot alerts",
      "Code scanning alerts",
      "Secret scanning alerts",
    ])
      expect(said, word).toContain(word);
    expect(
      screen
        .getByRole("link", { name: "Modifier l'App sur GitHub ↗" })
        .getAttribute("href"),
    ).toBe(url);
  });

  it.each([
    ["dependabot", "Dependabot n'est pas activé sur ce repo."],
    ["code_scanning", "Code scanning n'est pas activé sur ce repo."],
    ["secret_scanning", "Secret scanning n'est pas activé sur ce repo."],
  ] as const)(
    "given a refresh where %s is disabled, when it is done, then a gray line says « %s » and only that tool is named",
    async (tool, sentence) => {
      await open([finding(1)], {
        refresh: answer({ tools: { ...REFRESHED.tools, [tool]: "disabled" } }),
      });

      fireEvent.click(refreshButton());

      await waitFor(() => expect(grayLines().join(" ")).toContain(sentence));
      const said = grayLines().join(" ");
      const all = [
        "Dependabot n'est pas activé",
        "Code scanning n'est pas activé",
        "Secret scanning n'est pas activé",
      ];
      expect(all.filter((s) => said.includes(s))).toHaveLength(1);
      expect(screen.queryByRole("link", { name: /sur GitHub ↗/ })).toBeNull();
    },
  );

  it("given two tools disabled, when the refresh is done, then both are named", async () => {
    await open([finding(1)], {
      refresh: answer({
        tools: {
          dependabot: "disabled",
          code_scanning: "ok",
          secret_scanning: "disabled",
        },
      }),
    });

    fireEvent.click(refreshButton());

    await waitFor(() => expect(grayLines().length).toBeGreaterThan(0));
    expect(grayLines().join(" ")).toContain("Dependabot n'est pas activé");
    expect(grayLines().join(" ")).toContain("Secret scanning n'est pas activé");
  });
});

describe("decision 052 H: the findings of GitHub in the list", () => {
  const three = () => [
    alert(1, "dependabot", {
      title: "symfony/http-kernel : fuite",
      severity: "high",
    }),
    alert(2, "code_scanning", {
      title: "Requête SQL construite avec une entrée",
      severity: "medium",
    }),
    alert(3, "secret_scanning", {
      title: "Secret exposé : GitHub Personal Access Token",
      severity: "critical",
    }),
    finding(4, { title: "Un bug de Claude", severity: "low" }),
  ];

  it("given findings of the three tools, when the list is read, then each row says its source and its severity, and the first card says it too", async () => {
    await open(three());

    expect(featured().textContent).toContain("Secret exposé");
    expect(featured().textContent).toContain("secret · GitHub");
    expect(featured().textContent).toContain("critique");
    expect(rowOf("symfony/http-kernel").textContent).toContain(
      "dépendance · GitHub",
    );
    expect(rowOf("symfony/http-kernel").textContent).toContain("haute");
    expect(rowOf("Requête SQL").textContent).toContain("faille · GitHub");
    expect(rowOf("Requête SQL").textContent).toContain("moyenne");
    expect(rowOf("Un bug de Claude").textContent).not.toContain("GitHub");
    // They are of kind security: three failles, four constats, and the filter « Failles » shows them.
    expect(h1()).toContain("4 constats sur hello, dont 3 failles.");
    expect(
      within(main()).getByRole("link", { name: "Constats · 4" }),
    ).toBeDefined();
    fireEvent.click(filter("Failles"));
    expect(shown("symfony/http-kernel : fuite")).toBe(true);
    expect(shown("Secret exposé : GitHub Personal Access Token")).toBe(true);
    expect(shown("Un bug de Claude")).toBe(false);
  });
});

describe("decision 052 F: a finding closed on GitHub", () => {
  const closed = () =>
    alert(2, "dependabot", {
      title: "vendor/closed : corrigée",
      githubClosedAt: "2026-11-07T10:00:00.000Z",
    });

  it("given a finding closed on GitHub next to one to decide, when the screen opens, then it is not listed, not counted in the sentence nor in the chip, and not in the first card", async () => {
    await open([finding(1), closed()]);

    expect(shown("vendor/closed : corrigée")).toBe(false);
    expect(h1()).toContain("1 constat sur hello.");
    expect(
      within(main()).getByRole("link", { name: "Constats · 1" }),
    ).toBeDefined();
    expect(featured().textContent).not.toContain("vendor/closed");
  });

  it("given only findings closed on GitHub, when the screen opens, then nothing is to decide and there is no red", async () => {
    await open([closed()]);

    expect(screen.queryByText("1 · À corriger d'abord")).toBeNull();
    expect(h1()).toContain("Aucun constat à trancher sur hello.");
    expect(main().querySelectorAll('[class*="you-"]').length).toBe(0);
  });

  it("given a finding closed on GitHub and a dismissed one, when « Rejetés » is clicked, then both are shown, the first saying « fermée sur GitHub »", async () => {
    await open([
      finding(1),
      closed(),
      finding(3, { status: "dismissed", dismissReason: "faux positif" }),
    ]);

    fireEvent.click(filter("Rejetés"));

    expect(shown("vendor/closed : corrigée")).toBe(true);
    expect(shown("Constat numéro 3")).toBe(true);
    expect(shown("Constat numéro 1")).toBe(false);
    const list = within(main())
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(
      list
        .find((t) => t.includes("vendor/closed"))
        ?.includes("fermée sur GitHub"),
    ).toBe(true);
    expect(
      list
        .find((t) => t.includes("Constat numéro 3"))
        ?.includes("fermée sur GitHub"),
    ).toBe(false);
  });

  it("given a finding closed on GitHub opened from « Rejetés », when its panel shows, then it is read-only: no decision, no reason field, and it says it is closed on GitHub", async () => {
    await open([closed()]);
    fireEvent.click(filter("Rejetés"));

    openFinding("vendor/closed : corrigée");

    const aside = inPanel();
    expect(panel().textContent).toContain("Fermée sur GitHub");
    for (const name of ["En faire un ticket", "Rejeter", "Plus tard"])
      expect(aside.queryByRole("button", { name }), name).toBeNull();
    expect(aside.queryByText(/Raison du rejet/)).toBeNull();
    expect(aside.getByRole("button", { name: "Fermer" })).toBeDefined();
  });

  it("given a refresh that closes a finding, when the list is read again, then the finding leaves the list and the count follows", async () => {
    await open(
      [alert(1, "dependabot", { title: "vendor/a : un" }), finding(2)],
      {
        onRefresh: (list) => {
          const found = list.find((f) => f.id === 1) as FakeFinding;
          found.githubClosedAt = "2026-11-08T10:00:00.000Z";
        },
      },
    );
    expect(h1()).toContain("2 constats sur hello");

    fireEvent.click(refreshButton());

    await waitFor(() => expect(shown("vendor/a : un")).toBe(false));
    expect(h1()).toContain("1 constat sur hello");
  });
});

describe("decision 052 H: the panel of a finding of GitHub", () => {
  it("given a finding of GitHub, when its panel is open, then the link « Voir l'alerte sur GitHub ↗ » goes to its alert and no code is read", async () => {
    const api = await open([
      alert(7, "dependabot", { title: "vendor/a : un", bodyMd: "GHSA-aaaa" }),
      finding(1, { severity: "low" }),
    ]);

    openFinding("vendor/a : un");

    const link = inPanel().getByRole("link", {
      name: "Voir l'alerte sur GitHub ↗",
    });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/octocat/hello/security/dependabot/7",
    );
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
    expect(panel().textContent).toContain("GHSA-aaaa");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(api.codeReads()).toEqual([]);
    for (const name of ["En faire un ticket", "Rejeter", "Plus tard"])
      expect(inPanel().getByRole("button", { name })).toBeDefined();
    // A finding of Claude has no such link.
    openFinding("Constat numéro 1");
    expect(
      inPanel().queryByRole("link", { name: /Voir l'alerte sur GitHub/ }),
    ).toBeNull();
  });

  it("given a finding of GitHub that cites a line (code scanning), when its panel is open, then the code is shown with the link", async () => {
    const api = await open([
      alert(3, "code_scanning", {
        title: "Injection SQL",
        commitSha: "a1b2c3d".padEnd(40, "0"),
        sources: [
          {
            path: "api/src/db.ts",
            startLine: 5,
            endLine: 9,
            commitSha: "a1b2c3d".padEnd(40, "0"),
          },
        ],
      }),
    ]);

    openFinding("Injection SQL");

    await waitFor(() => expect(api.codeReads().length).toBeGreaterThan(0));
    expect(
      inPanel().getByRole("link", { name: "Voir l'alerte sur GitHub ↗" }),
    ).toBeDefined();
  });
});

describe("decision 052 K: the kind upgrade on the screen", () => {
  it("given an upgrade finding of Claude, when the screen opens, then it is listed and counted with the word « mise à jour », and the filter « Versions » shows it alone", async () => {
    await open([
      finding(1, {
        kind: "upgrade",
        title: "Passer de Node 20 à Node 22",
        severity: "medium",
      }),
      finding(2, { title: "Un bug", severity: "low" }),
    ]);

    expect(h1()).toContain("2 constats sur hello.");
    expect(featured().textContent).toContain("Passer de Node 20 à Node 22");
    expect(featured().textContent).toContain("mise à jour");

    fireEvent.click(filter("Versions"));

    expect(shown("Passer de Node 20 à Node 22")).toBe(true);
    expect(shown("Un bug")).toBe(false);
    expect(filter("Versions").getAttribute("aria-pressed")).toBe("true");
  });
});
