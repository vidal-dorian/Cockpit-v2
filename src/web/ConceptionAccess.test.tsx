// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT,
  API_MODULE,
  SKILL,
  stubConception,
  WEB_MODULE,
} from "./test-conception.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R1, review fixes: focus, keyboard and the wording of a pull request in the tab « Conception ».

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

async function open(modules = [API_MODULE, WEB_MODULE], options = {}) {
  const api = stubConception({ modules, ...options });
  renderAt("/projets/5/conception");
  fireEvent.click(await screen.findByRole("button", { name: "Liste" }));
  return api;
}

describe("the panel of an object", () => {
  it("given an object clicked, when its panel opens, then its heading takes the focus, and again when another object replaces it", async () => {
    await open();

    fireEvent.click(await screen.findByRole("button", { name: /^User/ }));
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("User"),
    );

    fireEvent.click(screen.getByRole("button", { name: /^Order/ }));
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe("Order"),
    );
  });

  it("given the panel open, when « Fermer » is clicked, then it closes and the focus returns to the button of the object", async () => {
    await open();
    const opener = await screen.findByRole("button", { name: /^User/ });
    fireEvent.click(opener);

    fireEvent.click(await screen.findByRole("button", { name: "Fermer" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Objet User" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(opener);
  });
});

describe("the module tabs", () => {
  it("given two modules, when ArrowRight, End, ArrowLeft and Home are pressed, then the selection and the focus move, and only the selected tab is a tab stop", async () => {
    await open();
    const tabs = () => screen.getAllByRole("tab");
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1]);
    expect(tabs()[0]?.getAttribute("aria-controls")).toBe(
      screen.getByRole("tabpanel").id,
    );
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      tabs()[0]?.id,
    );

    fireEvent.keyDown(tabs()[0] as HTMLElement, { key: "ArrowRight" });
    expect(tabs()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[1]);

    fireEvent.keyDown(tabs()[1] as HTMLElement, { key: "ArrowRight" });
    expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(tabs()[0] as HTMLElement, { key: "End" });
    expect(tabs()[1]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(tabs()[1] as HTMLElement, { key: "Home" });
    expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      tabs()[0]?.id,
    );
  });
});

describe("the link to GitHub", () => {
  it("given a cited path with a space and a #, when the panel opens, then each segment is encoded", async () => {
    const odd = {
      ...WEB_MODULE,
      data: {
        ...WEB_MODULE.data,
        objects: [
          {
            ...(WEB_MODULE.data
              .objects[0] as (typeof WEB_MODULE.data.objects)[0]),
            citation: { path: "my dir/a#b.ts", start_line: 1, end_line: 1 },
          },
        ],
      },
    };
    await open([odd]);

    fireEvent.click(await screen.findByRole("button", { name: /^Session/ }));

    const link = await screen.findByRole("link", { name: /Voir sur GitHub/ });
    expect(link.getAttribute("href")).toBe(
      `https://github.com/octocat/hello/blob/${odd.commitSha}/my%20dir/a%23b.ts#L1`,
    );
  });
});

describe("« Ajouter /analyser au repo » on a protected branch", () => {
  it("given an apply that answers a pull request, when it is done, then the window says a pull request is open and links to it", async () => {
    stubConception({
      apply: {
        status: 200,
        body: {
          commitSha: "c".repeat(40),
          created: [SKILL, AGENT],
          pullRequest: { url: "https://github.com/octocat/hello/pull/9" },
        },
      },
    });
    renderAt("/projets/5/conception");
    fireEvent.click(
      await screen.findByRole("button", { name: "Analyser avec Claude" }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Ajouter /analyser au repo" }),
    );

    expect(
      await screen.findByText(/La branche par défaut est protégée/),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "Voir la pull request" })
        .getAttribute("href"),
    ).toBe("https://github.com/octocat/hello/pull/9");
    expect(screen.queryByText("Voir le commit")).toBeNull();
  });
});
