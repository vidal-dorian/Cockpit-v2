// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal.tsx";
import { ScrollToTop } from "./Shell.tsx";

// Decision 079: the polish of motion, loading and feedback. jsdom plays no CSS: these tests pin what the CSS hangs on.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const dir = import.meta.dirname;
const css = readFileSync(join(dir, "styles.css"), "utf8");

function Nav() {
  const navigate = useNavigate();
  return (
    <>
      <Link to="/b">B</Link>
      <Link to="/b?us=3">Carte</Link>
      <button type="button" onClick={() => navigate(-1)}>
        Précédent
      </button>
    </>
  );
}

describe("079 D: a new page starts at the top", () => {
  const renderNav = () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <ScrollToTop />
        <Nav />
      </MemoryRouter>,
    );
    scrollTo.mockClear();
    return scrollTo;
  };

  it("given a scrolled page, when a link opens another page, then the window goes back to the top", () => {
    const scrollTo = renderNav();
    act(() => screen.getByText("B").click());
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("given a page, when only its query changes (a card of the Kanban), then the window does not move", () => {
    const scrollTo = renderNav();
    act(() => screen.getByText("B").click());
    scrollTo.mockClear();
    act(() => screen.getByText("Carte").click());
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("given a second page, when Précédent goes back, then the browser keeps its own scroll", () => {
    const scrollTo = renderNav();
    act(() => screen.getByText("B").click());
    scrollTo.mockClear();
    act(() => screen.getByText("Précédent").click());
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("079 E: every window rises in", () => {
  it("given a Modal, when it opens, then its dialog carries the entrance of the import window", () => {
    render(
      <Modal label="Fenêtre" onClose={() => {}}>
        contenu
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Fenêtre" }).className).toMatch(
      /\bdialog-in\b/,
    );
  });
});

describe("079 F: every « Chargement… » waits and spins", () => {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => !/\.test\.tsx$/.test(f) && !/^test-/.test(f));

  it.each(files)(
    "given %s, when an element shows « Chargement… », then it has the loading class",
    (file) => {
      const text = readFileSync(join(dir, file), "utf8");
      for (const [element] of text.matchAll(
        /<(p|span|div)\b[^>]*>\s*Chargement[^<]*</g,
      ))
        expect(element).toMatch(/className="[^"]*\bloading\b/);
    },
  );

  it("given styles.css, when I read the loading class, then it appears after a delay and has a spinner", () => {
    expect(css).toMatch(/\.loading\s*\{[^}]*animation:[^;}]*\b300ms\b/);
    expect(css).toMatch(/\.loading::before\s*\{/);
  });
});

describe("079 A, B, M: the motion of the whole page", () => {
  it("given styles.css, when I read it, then it holds the three durations and the curve", () => {
    for (const token of [
      "--duration-fast",
      "--duration-base",
      "--duration-slow",
    ])
      expect(css).toContain(token);
    expect(css).toMatch(/--ease-out:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  });

  it("given styles.css, when I read it, then buttons get a pointer and disabled ones say so", () => {
    expect(css).toMatch(/cursor:\s*pointer/);
    expect(css).toMatch(/:disabled[^{]*\{[^}]*cursor:\s*not-allowed/);
  });

  it("given styles.css, when the system asks for less motion, then animations and transitions are cut", () => {
    const reduce = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
    expect(reduce).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(reduce).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });
});
