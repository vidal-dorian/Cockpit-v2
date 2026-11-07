// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubShell } from "./test-shell.tsx";
import { renderAt } from "./test-tickets.tsx";

// Decision 028 D (the logo of the top bar), kept by 045 F in the sidebar: the logo link is named « Cockpit » and goes to `/`.
// The rest of the old top bar (navigation, Réglages) is covered by Shell.test.tsx.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("the logo of the sidebar", () => {
  it.each(["/", "/journal"])(
    "given a logged-in user, when %s is displayed, then the Cockpit link goes to / and starts with the handshake logo, which screen readers skip",
    async (path) => {
      stubShell({});
      renderAt(path);

      const cockpit = await screen.findByRole("link", { name: "Cockpit" });
      expect(cockpit.getAttribute("href")).toBe("/");
      const logo = cockpit.querySelector("svg.logo");
      expect(logo).not.toBeNull();
      expect(logo?.getAttribute("aria-hidden")).toBe("true");
      // Next to the word, on its left.
      expect(cockpit.firstElementChild).toBe(logo);
    },
  );
});
