// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_MODULE, stubConception } from "./test-conception.tsx";
import { panel } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Slice R2 (decision 047 F, G): the panel of an object of the map (R1) shows its code with the same CodeView as the takeover screen (src/web/CodeView.test.tsx):
// rows with data-line, the cited ones data-cited. The route answers lines 15 to 27 (`CODE-LINE-<n>`) and User cites lines 18 to 24.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("decision 047 F: the object panel uses CodeView", () => {
  it("given the panel of User (lines 18 to 24 cited, 15 to 27 read), when it is open, then every line is a data-line row and exactly the lines 18 to 24 are data-cited", async () => {
    stubConception({ modules: [API_MODULE] });
    renderAt("/projets/5/conception");
    fireEvent.click(await screen.findByRole("button", { name: /^User/ }));

    await waitFor(() => expect(panel().textContent).toContain("CODE-LINE-15"));

    const rows = [...panel().querySelectorAll<HTMLElement>("[data-line]")];
    expect(rows.map((r) => r.dataset.line)).toEqual(
      Array.from({ length: 13 }, (_, i) => String(15 + i)),
    );
    expect(
      rows
        .filter((r) => r.hasAttribute("data-cited"))
        .map((r) => r.dataset.line),
    ).toEqual(Array.from({ length: 7 }, (_, i) => String(18 + i)));
    // textContent, not getByText: once Shiki has coloured the line, its text is split across token spans.
    expect(rows[3]?.textContent).toContain("CODE-LINE-18");
  });
});
