import { describe, expect, it } from "vitest";
import { STARTER_LEVELS } from "../web/starter-levels.ts";
import { fromCatalog } from "./test-starter-teams.ts";

// Decision 072 A4: the agents and models shown on the cards of the carousel (`web/starter-levels.ts`, field `agents: { name, model }[]`)
// are the pairs of `catalog/teams/<id>.md`, so they never drift.
describe("decision 072 A4: the cards of the levels follow the catalog", () => {
  it.each(STARTER_LEVELS.map((l) => [l.id, l] as const))(
    "given the level %s, when its card is built, then its agents and models are those of catalog/teams/<id>.md",
    (id, level) => {
      const pairs = [
        ...fromCatalog(`teams/${id}.md`).matchAll(
          /^ {2}- agent: (\S+)\r?\n {4}model: (\S+)\s*$/gm,
        ),
      ].map(([, name, model]) => ({ name, model }));

      expect(pairs.length).toBeGreaterThan(0);
      expect(
        (level as { agents?: { name: string; model: string }[] }).agents,
      ).toEqual(pairs);
    },
  );
});
