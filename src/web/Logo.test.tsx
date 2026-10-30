// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Logo } from "./Logo.tsx";

afterEach(cleanup);

describe("Logo", () => {
  it("is decorative unless it has a label", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is an image named by its label", () => {
    render(<Logo label="Cockpit" />);
    expect(screen.getByRole("img", { name: "Cockpit" })).toBeTruthy();
  });

  it("keeps the class it is given next to its own", () => {
    const { container } = render(<Logo className="size-10" />);
    expect(container.querySelector("svg")?.getAttribute("class")).toBe(
      "logo size-10",
    );
  });

  it("gives two logos on one page their own gradients, and every reference resolves", () => {
    const { container } = render(
      <>
        <Logo />
        <Logo />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    const refs = [...container.innerHTML.matchAll(/url\(#([^)]+)\)/g)].map(
      (m) => m[1],
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ids).toContain(ref);
  });

  it("has the hooks the hover animation of styles.css targets", () => {
    const { container } = render(<Logo />);
    const count = (selector: string) =>
      container.querySelectorAll(selector).length;
    expect(count(".logo-human")).toBe(1);
    expect(count(".logo-claude")).toBe(1);
    expect(count(".logo-hand")).toBe(1);
    expect(count(".logo-finger")).toBe(5);
    expect(count(".logo-wire")).toBe(3);
    expect(count(".logo-dot")).toBe(3);
  });
});
