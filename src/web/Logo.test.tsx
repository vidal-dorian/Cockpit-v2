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

  it("given the Logo, when rendered, then it draws four .logo-arc in one .logo-loop group and one .logo-core", () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 120 120");
    expect(container.querySelectorAll(".logo-loop").length).toBe(1);
    expect(container.querySelectorAll(".logo-loop .logo-arc").length).toBe(4);
    expect(container.querySelectorAll(".logo-arc").length).toBe(4);
    expect(container.querySelectorAll(".logo-core").length).toBe(1);
  });

  it("given the Logo, when rendered, then the arcs are filled with the four tokens in order and no colour is hard-coded", () => {
    const { container } = render(<Logo />);
    const fills = [...container.querySelectorAll(".logo-arc")].map(
      (e) =>
        e.getAttribute("fill") ??
        (e as SVGElement).style.getPropertyValue("fill"),
    );
    expect(fills).toEqual([
      "var(--logo-idea)",
      "var(--logo-you)",
      "var(--logo-claude)",
      "var(--logo-done)",
    ]);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}(?![0-9a-z])/i);
    expect(container.innerHTML).not.toMatch(/rgba?\(/i);
  });

  it("given the Logo, when rendered, then each arc stays within its quarter of the square", () => {
    const { container } = render(<Logo />);
    const arcs = [...container.querySelectorAll(".logo-arc")];
    expect(arcs.length).toBe(4);
    // Quarter of arc i, as [x sign, y sign] from the centre (60, 60): y grows downwards.
    const quarters = [
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ];
    arcs.forEach((arc, i) => {
      const points = pathPoints(arc.getAttribute("d") ?? "");
      expect(points.length).toBeGreaterThan(2);
      for (const [x, y] of points) {
        expect((x - 60) * (quarters[i]?.[0] ?? 0)).toBeGreaterThanOrEqual(0);
        expect((y - 60) * (quarters[i]?.[1] ?? 0)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it("given two Logos on one page, when rendered, then no id appears twice and every url(#) reference resolves", () => {
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
    for (const ref of refs) expect(ids).toContain(ref);
  });
});

/** End points of every segment of an svg path (curve control points left out). */
function pathPoints(d: string): [number, number][] {
  const points: [number, number][] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (const [, cmd = "", args = ""] of d.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    const n = (args.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const size = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 }[
      cmd.toLowerCase() as "m"
    ];
    if (size === 0) {
      x = startX;
      y = startY;
      continue;
    }
    for (let k = 0; k + size <= n.length; k += size) {
      const seg = n.slice(k, k + size);
      const c = cmd.toLowerCase();
      if (c === "h") x = rel ? x + (seg[0] ?? 0) : (seg[0] ?? 0);
      else if (c === "v") y = rel ? y + (seg[0] ?? 0) : (seg[0] ?? 0);
      else {
        const [ex = 0, ey = 0] = seg.slice(-2);
        x = rel ? x + ex : ex;
        y = rel ? y + ey : ey;
      }
      if (c === "m" && k === 0) {
        startX = x;
        startY = y;
      }
      points.push([x, y]);
    }
  }
  return points;
}
