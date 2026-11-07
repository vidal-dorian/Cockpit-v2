// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { JournalEntry } from "./Journal.tsx";

// Slices R1, R2 and C1 (decisions 043 E, 047 and 049): the entries of the map and the rules are named in French, never by their code.

afterEach(cleanup);

const entry = (action: string, origin: string) =>
  ({
    id: 1,
    at: "2026-11-07T12:00:00.000Z",
    actor: origin === "mcp" ? "claude" : "human",
    origin,
    action,
    result: "ok",
    project: null,
  }) as unknown as Parameters<typeof JournalEntry>[0]["entry"];

describe("decisions 043 E and 047: the Journal names the map and rule entries", () => {
  it.each([
    ["submit_code_map", "mcp", "Carte du code déposée"],
    ["create_takeover_stories", "mcp", "Règles de reprise écrites"],
    ["keep_rule", "ui", "Règle validée"],
    ["unkeep_rule", "ui", "Validation de la règle annulée"],
    ["edit_rule", "ui", "Règle corrigée"],
    ["bug_rule", "ui", "Règle notée comme bug"],
    ["update_catalog", "ui", "Fichiers de Claude mis à jour"],
    ["submit_findings", "mcp", "Constats déposés"],
    ["list_findings", "mcp", "Constats listés"],
    ["ticket_finding", "ui", "Constat transformé en ticket"],
    ["dismiss_finding", "ui", "Constat rejeté"],
    ["later_finding", "ui", "Constat remis à plus tard"],
  ])(
    "given an entry of %s (origin %s), when it is shown, then it reads « %s » and never the code",
    (action, origin, label) => {
      render(
        <ul>
          <JournalEntry entry={entry(action, origin)} />
        </ul>,
      );

      expect(screen.getByText(label)).toBeDefined();
      expect(document.body.textContent).not.toContain(action);
    },
  );
});
