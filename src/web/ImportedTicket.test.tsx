// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderAt, story } from "./test-tickets.tsx";
import { rich, stubTab } from "./test-tickets-full.tsx";

// Slice 11.3, decision 056 G and H: a ticket imported from an issue says so, and its text comes from a third party.
//
// Pinned choices (the decision leaves them open):
// - A ticket carries `githubIssueNumber: number | null`. When it is a number, the ticket page (/tickets/:id) and the panel of the Tickets tab show « Importé de l'issue #57 ↗ »
//   as ONE link whose text contains « Importé de l'issue #57 », href https://github.com/<owner>/<repo>/issues/57 (the repo is the project's full name, octocat/hello here),
//   target _blank and rel containing noopener. A ticket without number shows no such text.
// - H: the description is the safe Markdown of decision 014 H (no HTML element, no image, no javascript: link) and the title is plain text (« <i>brut</i> » stays characters).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const imported = (id: number, title: string, descriptionMd = "") => ({
  ...rich(id, title, { descriptionMd }),
  githubIssueNumber: 57,
});
const main = () => screen.getByRole("main");
const ISSUE_URL = "https://github.com/octocat/hello/issues/57";

function expectIssueLink(root: HTMLElement) {
  const link = within(root).getByRole("link", {
    name: /Importé de l'issue #57/,
  });
  expect(link.getAttribute("href")).toBe(ISSUE_URL);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
}

describe("056 G: the ticket page", () => {
  it("given a ticket imported from the issue 57, when its page loads, then it says Importé de l'issue #57 with a link to the issue on GitHub", async () => {
    stubTab([imported(7, "Le bouton ne répond pas", "Du texte")] as never, []);

    renderAt("/tickets/7");

    await screen.findByRole("heading", {
      level: 1,
      name: /^Le bouton ne répond pas/,
    });
    expectIssueLink(main());
  });

  it("given a ticket made by hand, when its page loads, then there is no Importé de l'issue", async () => {
    stubTab(
      [{ ...rich(7, "À la main"), githubIssueNumber: null }] as never,
      [],
    );

    renderAt("/tickets/7");

    await screen.findByRole("heading", { level: 1, name: /^À la main/ });
    expect(screen.queryByText(/Importé de l'issue/)).toBeNull();
  });
});

describe("056 G: the panel of the Tickets tab", () => {
  it("given an imported ticket and a ticket made by hand, when each row is opened, then the panel of the imported one links to the issue and the other says nothing", async () => {
    stubTab(
      [
        imported(11, "Importé"),
        { ...rich(12, "À la main"), githubIssueNumber: null },
      ] as never,
      [story(42, 11, "Une US", { status: "ready" })],
    );
    renderAt("/projets/5/tickets");

    fireEvent.click(await screen.findByRole("button", { name: "Importé" }));
    const aside = await screen.findByRole("complementary", { name: "Ticket" });
    expectIssueLink(aside);

    fireEvent.click(screen.getByRole("button", { name: "À la main" }));
    await within(
      await screen.findByRole("complementary", { name: "Ticket" }),
    ).findByRole("heading", { name: "À la main" });
    expect(screen.queryByText(/Importé de l'issue/)).toBeNull();
  });
});

describe("056 H: the text that comes from GitHub", () => {
  const body = [
    'Avant <img src=x onerror=alert(1)> milieu <script>window.__pwned = 1</script> <b onclick="alert(2)">gras HTML</b>',
    "",
    "[clic](javascript:alert(3))",
    "",
    "![x](https://tracker.example/p.png)",
    "",
    "Du **vrai gras**.",
  ].join("\n");

  it("given an imported ticket whose body holds raw HTML, an image and a javascript: link, when its page loads, then only the safe Markdown is rendered, the title stays text, and the link to the issue is there", async () => {
    stubTab([imported(7, "Titre <i>brut</i>", body)] as never, []);

    renderAt("/tickets/7");

    const h1 = await screen.findByRole("heading", { level: 1, name: /Titre/ });
    expect(h1.textContent).toContain("<i>brut</i>");
    expect(h1.querySelector("i")).toBeNull();
    expectIssueLink(main());
    expect(main().querySelector("img")).toBeNull();
    expect(main().querySelector("script")).toBeNull();
    expect(main().querySelector("b")).toBeNull();
    expect(within(main()).getByText("vrai gras").tagName).toBe("STRONG");
    expect(document.querySelector("[onerror], [onclick]")).toBeNull();
    expect(document.querySelector('[src*="tracker.example"]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    for (const a of main().querySelectorAll("a"))
      expect(a.getAttribute("href") ?? "").not.toMatch(/^\s*javascript:/i);
  });
});
