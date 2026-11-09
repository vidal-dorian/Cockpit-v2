// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addErgonomics } from "./test-ergonomics.tsx";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice 15.3 (decision 073 H): the favourite projects.
//
// Pinned choices (the decision leaves them open):
// - GET /api/projects and the `projects` of GET /api/home carry `favorite: boolean` (the page reads the first, the sidebar the second).
// - Each row (<li>) of /projets has a button « Ajouter aux favoris » (aria-pressed false) or « Retirer des favoris » (aria-pressed true); a click sends
//   PUT /api/projects/:id/favorite { favorite: <the new value> } and, once the list is read again, the row shows the other state.
// - A button « Favoris · n » (n favourites, aria-pressed) narrows the list to the favourites.
// - The sidebar label is « Projets favoris » when there is a favourite; the links of the projects come favourites first (by id), then the active ones that are not.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const repo = (id: number, name: string, favorite: boolean) => ({
  id,
  fullName: `octocat/${name}`,
  defaultBranch: "main",
  archived: false,
  favorite,
});
const PROJECTS = [
  repo(5, "hello", false),
  repo(8, "world", true),
  repo(9, "moon", false),
];

function start() {
  const api = stubShell({
    projects: [
      { id: 5, name: "octocat/hello", state: "claude", favorite: false },
      { id: 8, name: "octocat/world", state: "idle", favorite: true },
      { id: 9, name: "octocat/moon", state: "idle", favorite: false },
      { id: 10, name: "octocat/sun", state: "for_you", favorite: true },
    ] as never,
  });
  const fakes = addErgonomics({
    projects: PROJECTS.map((p) => ({ ...p })),
    onFavorite: (id, favorite) => {
      for (const p of api.state.home.projects as { id: number }[])
        if (p.id === id) Object.assign(p, { favorite });
    },
  });
  renderAt("/projets");
  return fakes;
}
const row = async (name: string) => {
  const link = await screen.findByRole("link", { name });
  return within(link.closest("li") as HTMLElement);
};

describe("slice 15.3 H: the star of Tous les projets", () => {
  it("given a favourite and a plain project, when the page loads, then each row has its star button with aria-pressed and the right name", async () => {
    start();

    const world = (await row("world")).getByRole("button", {
      name: "Retirer des favoris",
    });
    const hello = (await row("hello")).getByRole("button", {
      name: "Ajouter aux favoris",
    });

    expect(world.getAttribute("aria-pressed")).toBe("true");
    expect(hello.getAttribute("aria-pressed")).toBe("false");
  });

  it("given a plain project, when its star is clicked, then PUT /api/projects/5/favorite sends favorite true and the row shows Retirer des favoris", async () => {
    const api = start();

    fireEvent.click(
      (await row("hello")).getByRole("button", { name: "Ajouter aux favoris" }),
    );

    await waitFor(() =>
      expect(api.calls.filter((c) => c.method === "PUT")).toEqual([
        expect.objectContaining({
          path: "/api/projects/5/favorite",
          body: { favorite: true },
        }),
      ]),
    );
    expect(
      (await row("hello"))
        .getByRole("button", { name: "Retirer des favoris" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("given one favourite among three, when « Favoris · 1 » is clicked, then only the favourite is listed", async () => {
    start();
    await row("hello");

    fireEvent.click(screen.getByRole("button", { name: /Favoris · 1/ }));

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "hello" })).toBeNull(),
    );
    expect(screen.queryByRole("link", { name: "moon" })).toBeNull();
    expect(screen.getByRole("link", { name: "world" })).toBeDefined();
  });
});

describe("slice 15.3 H: the sidebar", () => {
  it("given two favourites, one idle, and an active project that is not one, when a page loads, then « Projets favoris » lists the favourites first, then the active one, and not the idle one", async () => {
    start();

    const side = within(
      await screen.findByRole("complementary", { name: "Barre latérale" }),
    );
    expect(await side.findByText("Projets favoris")).toBeDefined();
    const hrefs = [...document.querySelectorAll("aside a")]
      .map((a) => a.getAttribute("href"))
      .filter((h) => /^\/projets\/\d+$/.test(h ?? ""));
    expect(hrefs).toEqual(["/projets/8", "/projets/10", "/projets/5"]);
  });
});
