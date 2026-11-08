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
import {
  entry,
  type FakeEntry,
  redClasses,
  stubJournal,
} from "./test-journal.tsx";

// Decision 053 G and J (slice 11.1): the panel of an entry on the Journal page (S40) and the colour budget.
//
// Pinned choices (the decision leaves them open):
// - A row of the journal holds one <button> (its whole content) that opens the entry in the right panel (`Panel` of Shell.tsx, label « Entrée du journal », badge « Entrée du journal »).
//   The panel is absent until a row is clicked.
// - The title is an <h2> « <action> <résultat> » with the raw action name and the word réussi, refusé or erreur (S40: « create_user_stories refusé »).
// - The fields are a <dl>: a <dt> Quand, Acteur, Origine, Projet, Résultat, Arguments, each followed by its <dd>.
//   Quand holds the date and the time with seconds (toLocaleTimeString("fr-FR")); Acteur the word Toi, Claude, GitHub or Cockpit; Origine Interface, MCP, Webhook or Cockpit;
//   Projet the full name of the project; Résultat the word (réussi, refusé, erreur) and, for a refusal, its code (detail.reason); Arguments a <pre> with the `font-mono` class holding JSON.stringify(args, null, 2).
// - A refused or failed entry with a retry shows a <button> named « Claude a réessayé à <H:MM> : <réussi|refusé|erreur>. » (the time as toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" })); only the actor claude is pinned;
//   the click opens that retry (it is one of the entries shown). Without a retry, or for an ok entry, there is no such sentence.
// - The counter is the one of `Panel`: « i sur n » (n = the entries shown, i the open one, newest first) and the buttons Précédent (↑, goes to the entry above) and Suivant (↓, goes to the one below);
//   the keys ArrowUp and ArrowDown on the page do the same.
// - Colour (J): a refused entry uses the same gray result word as an ok one; no destructive, red or `you` class on a refused row, the filter chip Refusé or the panel.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

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

const at = (minute: number, second = 0) =>
  new Date(2026, 10, 11, 8, minute, second).toISOString();
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "numeric",
    minute: "2-digit",
  });

/** Seven entries, ids 1 to 7, the newest (7) first on the page. Entry 3 is a refusal retried by entry 4. */
const REFUSED: FakeEntry = entry(3, {
  at: at(40, 12),
  actor: "claude",
  origin: "mcp",
  action: "create_user_stories",
  result: "refused",
  project: "octocat/api-facturation",
  projectId: 6,
  ticketId: 31,
  args: { ticket_id: 31, count: 2, dry_run: false },
  detail: { reason: "criterion_incomplete" },
  retry: { id: 4, at: at(41, 5), result: "ok" },
});
const RETRY: FakeEntry = entry(4, {
  at: at(41, 5),
  actor: "claude",
  origin: "mcp",
  action: "create_user_stories",
  project: "octocat/api-facturation",
  projectId: 6,
  args: { ticket_id: 31 },
});
const SEVEN = [
  entry(7, { at: at(50), action: "update_ticket" }),
  entry(6, { at: at(45), action: "ask_user", actor: "claude", origin: "mcp" }),
  entry(5, { at: at(42), action: "create_ticket" }),
  RETRY,
  REFUSED,
  entry(2, { at: at(30), action: "logout" }),
  entry(1, { at: at(20), action: "login" }),
];

async function open(entries: FakeEntry[], path = "/journal") {
  stubJournal(() => ({ entries }));
  renderAt(path);
  await screen.findByRole("heading", { level: 1 });
}
const rows = () =>
  [...screen.getByRole("main").querySelectorAll("li")] as HTMLElement[];
/** The button of the row of entry `id` (SEVEN lists them newest first, 7 down to 1). */
const rowButton = async (id: number) => {
  await screen.findByText("Connexion");
  const row = rows()[SEVEN.findIndex((e) => e.id === id)];
  if (!row) throw new Error(`no row for ${id}`);
  return within(row).getByRole("button");
};
const panel = () =>
  screen.getByRole("complementary", { name: "Entrée du journal" });
const field = (name: string) => {
  const dt = [...panel().querySelectorAll("dt")].find(
    (d) => d.textContent?.trim() === name,
  );
  return dt?.nextElementSibling as HTMLElement | undefined;
};
const counter = () => within(panel()).getByText(/^\d+ sur \d+$/).textContent;
const title = () =>
  within(panel()).getByRole("heading", { level: 2 }).textContent?.trim();

describe("Journal, the panel of an entry (decision 053 G)", () => {
  it("given the journal loaded, when no row has been clicked, then there is no panel", async () => {
    await open(SEVEN);

    expect(
      screen.queryByRole("complementary", { name: "Entrée du journal" }),
    ).toBeNull();
  });

  it("given a refused entry, when its row is clicked, then the panel opens titled « create_user_stories refusé » with the badge Entrée du journal", async () => {
    await open(SEVEN);

    fireEvent.click(await rowButton(3));

    expect(title()).toBe("create_user_stories refusé");
    expect(panel().textContent).toContain("Entrée du journal");
  });

  it("given a refused entry of Claude by MCP on a project with a code, when it is open, then the panel gives Quand with the seconds, Acteur, Origine, Projet and Résultat with its code", async () => {
    await open(SEVEN);

    fireEvent.click(await rowButton(3));

    expect(field("Quand")?.textContent).toContain(
      new Date(REFUSED.at).toLocaleTimeString("fr-FR"),
    );
    expect(field("Acteur")?.textContent).toContain("Claude");
    expect(field("Origine")?.textContent).toContain("MCP");
    expect(field("Projet")?.textContent).toContain("octocat/api-facturation");
    expect(field("Résultat")?.textContent).toContain("refusé");
    expect(field("Résultat")?.textContent).toContain("criterion_incomplete");
  });

  it("given an entry of the user by the interface, when it is open, then Acteur reads Toi and Origine Interface", async () => {
    await open(SEVEN);

    fireEvent.click(await rowButton(5));

    expect(title()).toBe("create_ticket réussi");
    expect(field("Acteur")?.textContent).toContain("Toi");
    expect(field("Origine")?.textContent).toContain("Interface");
  });

  it("given an entry with args, when it is open, then Arguments is their JSON in a monospace block", async () => {
    await open(SEVEN);

    fireEvent.click(await rowButton(3));

    const pre = field("Arguments")?.querySelector("pre");
    expect(pre?.className).toContain("font-mono");
    expect(JSON.parse(pre?.textContent ?? "")).toEqual(REFUSED.args);
  });

  it("given a refusal with a retry, when it is open, then the panel says « Claude a réessayé à <time> : réussi. »", async () => {
    await open(SEVEN);

    fireEvent.click(await rowButton(3));

    expect(
      within(panel()).getByRole("button", {
        name: `Claude a réessayé à ${clock(at(41, 5))} : réussi.`,
      }),
    ).toBeDefined();
  });

  it("given the retry sentence, when it is clicked, then the panel shows the retry entry", async () => {
    await open(SEVEN);
    fireEvent.click(await rowButton(3));

    fireEvent.click(
      within(panel()).getByRole("button", {
        name: `Claude a réessayé à ${clock(at(41, 5))} : réussi.`,
      }),
    );

    expect(title()).toBe("create_user_stories réussi");
    expect(counter()).toBe("4 sur 7");
    expect(field("Quand")?.textContent).toContain(
      new Date(RETRY.at).toLocaleTimeString("fr-FR"),
    );
  });

  it.each([
    ["a refusal without a retry", entry(3, { ...REFUSED, retry: null })],
    ["an ok entry", entry(3, { ...REFUSED, result: "ok", retry: undefined })],
  ])(
    "given %s, when it is open, then there is no retry sentence",
    async (_name, replaced) => {
      await open(SEVEN.map((e) => (e.id === 3 ? replaced : e)));

      fireEvent.click(await rowButton(3));

      expect(panel().textContent).not.toContain("a réessayé");
    },
  );

  it("given an entry opened, when it is the 3rd of 7 entries, then the counter reads « 3 sur 7 »", async () => {
    await open(SEVEN);

    fireEvent.click(await rowButton(5));

    expect(counter()).toBe("3 sur 7");
  });

  it("given an entry open, when Suivant then Précédent are clicked, then the panel goes to the entry below then back", async () => {
    await open(SEVEN);
    fireEvent.click(await rowButton(5));

    fireEvent.click(within(panel()).getByRole("button", { name: "Suivant" }));
    expect(counter()).toBe("4 sur 7");
    expect(title()).toBe("create_user_stories réussi");

    fireEvent.click(within(panel()).getByRole("button", { name: "Précédent" }));
    expect(counter()).toBe("3 sur 7");
    expect(title()).toBe("create_ticket réussi");
  });

  it("given the first entry open, when the panel is read, then Précédent is disabled, and Suivant on the last", async () => {
    await open(SEVEN);

    fireEvent.click(await rowButton(7));
    expect(counter()).toBe("1 sur 7");
    expect(
      (
        within(panel()).getByRole("button", {
          name: "Précédent",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(await rowButton(1));
    expect(counter()).toBe("7 sur 7");
    expect(
      (
        within(panel()).getByRole("button", {
          name: "Suivant",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("given an entry open, when ArrowDown then ArrowUp are pressed, then the panel goes to the entry below then back", async () => {
    await open(SEVEN);
    fireEvent.click(await rowButton(5));

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(counter()).toBe("4 sur 7");

    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(counter()).toBe("2 sur 7");
    expect(title()).toBe("ask_user réussi");
  });
});

describe("Journal, the colour (decision 053 J)", () => {
  it("given a refused and an ok entry, when the journal loads, then the two result words carry the same classes (gray), and the refused row has no red", async () => {
    await open([
      entry(2, { action: "login", at: at(20) }),
      entry(1, {
        action: "login",
        result: "refused",
        at: at(10),
        detail: { reason: "x" },
      }),
    ]);

    const [ok, refused] = [
      await screen.findByText("Réussie"),
      await screen.findByText("Refusée"),
    ];
    expect(refused.className).toBe(ok.className);
    const row = refused.closest("li") as HTMLElement;
    expect(redClasses(row)).toEqual([]);
  });

  it("given the view filtered on Refusé, when it shows a refused entry and its panel, then nothing in the page or the panel is red", async () => {
    await open([REFUSED], "/journal?resultat=refuse");
    await screen.findByText("Refusée");

    expect(redClasses(screen.getByRole("main"))).toEqual([]);
    const row = (await screen.findByText("Refusée")).closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button"));
    expect(redClasses(panel())).toEqual([]);
    expect(redClasses(screen.getByRole("main"))).toEqual([]);
  });
});
