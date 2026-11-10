// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fail, renderAt, stubTicketApi, ticket } from "./test-tickets.tsx";
import { TOAST_MS, Toaster, toast } from "./toast.tsx";

// Decision 080: a busy button spins, a finished action says so.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

const dir = import.meta.dirname;
const css = readFileSync(join(dir, "styles.css"), "utf8");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".tsx"))
  .filter((f) => !/\.test\.tsx$/.test(f) && !/^test-/.test(f));

describe("080 A: a button waiting for its request spins", () => {
  it.each(files)(
    "given %s, when a button is disabled while its mutation runs, then it says it is busy with that mutation",
    (file) => {
      const text = readFileSync(join(dir, file), "utf8");
      for (const match of text.matchAll(
        /disabled=\{([^{}]*(?:\.isPending|(?<![.\w])(?:pending|validating|deleting|busy|sending)\b|canSend|canValidate|canLaunch|canCommit|\boff\b|commit\.disabled|disabled \|\| !allowed)[^{}]*)\}/g,
      )) {
        const expr = match[1];
        // A request flag, read directly or through a prop or a variable; canSend, canValidate, canLaunch, canCommit, off and the CI commit's disabled hide one.
        const pending = expr?.match(
          /[\w.]+\.isPending|(?<![.\w])(?:pending|validating|deleting|busy|sending)\b|\.isPending|\.busy/g,
        ) ?? [".isPending", "pending", "busy"];
        // aria-busy follows disabled on the same element.
        const busy =
          /^\s*aria-busy=\{([^}]*)\}/.exec(
            text.slice((match.index ?? 0) + match[0].length),
          )?.[1] ?? "";
        expect(busy, `${file}: ${expr}`).not.toBe("");
        expect(
          // A local alias (busy = send.isPending || send.isSuccess) may give way to the request itself.
          pending.some((p) => busy.includes(p)) || busy.includes(".isPending"),
          `${file}: ${expr}`,
        ).toBe(true);
      }
    },
  );

  it("given styles.css, when a button is busy, then it shows a spinning ring and the progress cursor", () => {
    expect(css).toMatch(
      /\[aria-busy="true"\]\[data-pressed\]::before\s*\{[^}]*animation:\s*spin/,
    );
    expect(css).toMatch(/\[aria-busy="true"\]\s*\{[^}]*cursor:\s*progress/);
  });
});

describe("080 B: a finished action says so", () => {
  it("given the Toaster, when toast is called, then the line shows and leaves after 4 s", () => {
    vi.useFakeTimers();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Toaster />
      </QueryClientProvider>,
    );
    act(() => toast("Ticket enregistré."));
    expect(screen.getByText("Ticket enregistré.")).toBeDefined();
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(screen.queryByText("Ticket enregistré.")).toBeNull();
  });

  it("given a ticket page, when its form is saved, then « Ticket enregistré. » appears", async () => {
    stubTicketApi([ticket(7, "Avant", "ancien")]);
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Avant/ });
    act(() => screen.getByRole("button", { name: "Modifier" }).click());
    act(() => screen.getByRole("button", { name: "Enregistrer" }).click());
    expect(await screen.findByText("Ticket enregistré.")).toBeDefined();
  });
});

describe("080 D: a refused action says nothing in the bottom line", () => {
  it("given a ticket whose project got archived, when its form is saved and refused, then the error shows and no confirmation", async () => {
    const api = stubTicketApi([ticket(7, "Avant", "ancien")]);
    api.failNext.patch = fail(409, "project_archived");
    renderAt("/tickets/7");
    await screen.findByRole("heading", { level: 1, name: /^Avant/ });
    act(() => screen.getByRole("button", { name: "Modifier" }).click());
    act(() => screen.getByRole("button", { name: "Enregistrer" }).click());
    await screen.findByRole("alert");
    expect(screen.queryByText("Ticket enregistré.")).toBeNull();
  });
});
