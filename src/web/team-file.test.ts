import { describe, expect, it } from "vitest";
import { parseTeam } from "../server/team.ts";
import {
  addStep,
  DEFAULT_STEPS,
  insertStepAfter,
  linkOnCanvas,
  linkSteps,
  moveStep,
  readTeam,
  removeStep,
  stepLabel,
  type TeamStep,
  teamChecks,
  teamSummary,
  untilChoice,
  writeTeam,
} from "./team-file.ts";

// Slice E3 (decision 031 C, G): the pure reader, writer and draft functions of `.claude/team.md`, `src/web/team-file.ts`.
//
// Pinned where the decision leaves it open:
// - A step is `{ agent, does, loopTo, until }`: `does` and `until` strings ("" when absent), `loopTo` an agent name or null.
// - `readTeam(text)` is `{ steps, body }` (body: everything after the closing `---` line, after its line break), or `null` when Cockpit cannot rewrite the file without loss.
// - `writeTeam(steps, body)` returns the whole file text: the front matter of 031 G, then `body` byte for byte. `does` is always written, `loop_to` and `until` only for a step with a loop.
// - `DEFAULT_STEPS` is the draft without a file (029 C).
// Slice E6 (decision 079), new exports assumed in `src/web/team-file.ts` (the developer implements these names):
// - `TeamStep` gains four OPTIONAL fields, undefined when absent (so `toEqual` of a plain step still holds): `id?: string`, `parallel?: boolean`, `max?: number` (no `wait`: a group always waits for all its steps, an older `wait` key is read and ignored).
//   The key of a step is `id ?? agent`; `loopTo`, and the key arguments of moveStep / removeStep / linkSteps, name a key.
// - `DEFAULT_STEPS` reviewer gets `max: 3` (a loop always has a limit, 079 C: otherwise « Faire le commit » of the default team would be disabled).
// - `addStep` adds an agent already in the team with the free `id` "2", "3"... (079 D5, changes the 031 E behaviour).
// - `linkOnCanvas(steps, fromKey, toKey, until = "the verdict is ready", max = 3)`: the canvas gesture of 079 D5 (the in-page `linkSteps` keeps 031 C).
// - `insertStepAfter(steps, key, agent, does = "")`: the agent becomes a step of its own right after the step `key` (079 D5, « + » on a link).
// - `teamSummary(steps): string` (079 D2), `teamChecks(steps): { ok: boolean; text: string }[]` (079 D6), `stepLabel(step): string`,
//   `untilChoice(until, agent): string` the label of the choice of « Quand suivre ce lien » (079 C).
// - The draft functions are pure and return a new array; `agent`s are names:
//   `linkSteps(steps, from, to, until = "")` is the link of 031 C (a loop to an earlier step or itself, with the condition `until`; or `to` moved right after `from`);
//   `moveStep(steps, agent, "up" | "down")`; `removeStep(steps, agent)`; `addStep(steps, agent, does = "")` appends last, and does nothing when the agent is already there.
//   A loop removed by a reorder has `loopTo: null` and `until: ""`.

const step = (
  agent: string,
  loopTo: string | null = null,
  until = "",
  does = `${agent} does`,
): TeamStep => ({ agent, does, loopTo, until });
const names = (steps: TeamStep[]) => steps.map((s) => s.agent);
const abc = () => [step("a"), step("b"), step("c")];

const TEXT = `---
steps:
  - agent: test-writer
    does: "writes the tests"
  - agent: developer
    does: "implements"

  - agent: reviewer
    does: "reviews \\"the\\" diff"
    loop_to: developer
    until: "the verdict is ready"
---
Body kept.

  Two  paragraphs
`;

describe("decision 031 G: readTeam", () => {
  it("given a file in Cockpit's format, when it is read, then the steps come in order with JSON values unquoted and the body follows", () => {
    expect(readTeam(TEXT)).toEqual({
      steps: [
        {
          agent: "test-writer",
          does: "writes the tests",
          loopTo: null,
          until: "",
        },
        { agent: "developer", does: "implements", loopTo: null, until: "" },
        {
          agent: "reviewer",
          does: 'reviews "the" diff',
          loopTo: "developer",
          until: "the verdict is ready",
        },
      ],
      body: "Body kept.\n\n  Two  paragraphs\n",
    });
  });

  it("given a step with only its agent, when it is read, then does and until are empty and loopTo is null", () => {
    expect(readTeam("---\nsteps:\n  - agent: a\n---\n")?.steps).toEqual([
      { agent: "a", does: "", loopTo: null, until: "" },
    ]);
  });

  it.each([
    ["no front matter", "steps:\n  - agent: a\n"],
    ["an unclosed front matter", "---\nsteps:\n  - agent: a\n"],
    ["no step", "---\nsteps:\n---\n"],
    ["a quoted agent name", '---\nsteps:\n  - agent: "a"\n---\n'],
    ["a step whose first key is not agent", "---\nsteps:\n  - does: x\n---\n"],
    [
      "a comment line in the front matter",
      "---\nsteps:\n  # why\n  - agent: a\n---\n",
    ],
    ["another top-level key", "---\nname: x\nsteps:\n  - agent: a\n---\n"],
    [
      "another top-level key after the steps",
      "---\nsteps:\n  - agent: a\nowner: me\n---\n",
    ],
    [
      "another key in a step",
      "---\nsteps:\n  - agent: a\n    color: red\n---\n",
    ],
    [
      "a multi-line value",
      "---\nsteps:\n  - agent: a\n    does: >\n      long\n      text\n---\n",
    ],
    [
      "an until without loop_to",
      "---\nsteps:\n  - agent: a\n    until: done\n---\n",
    ],
    ["the same agent twice", "---\nsteps:\n  - agent: a\n  - agent: a\n---\n"],
    [
      "a bare value with a comment",
      "---\nsteps:\n  - agent: a\n    does: x # y\n---\n",
    ],
    [
      "a bare value starting with a flow bracket",
      "---\nsteps:\n  - agent: a\n    does: [x]\n---\n",
    ],
    [
      "a comment starting a bare value",
      "---\nsteps:\n  - agent: a\n    does: # todo\n---\n",
    ],
    [
      "a comment after a tab",
      "---\nsteps:\n  - agent: a\n    does: x\t# todo\n---\n",
    ],
    [
      "a loop to an unknown agent",
      "---\nsteps:\n  - agent: a\n    loop_to: zz\n    until: x\n---\n",
    ],
    [
      "a loop to a later step",
      "---\nsteps:\n  - agent: a\n    loop_to: b\n    until: x\n  - agent: b\n---\n",
    ],
  ])(
    "given %s, when it is read, then it is not rewritable (null)",
    (_n, text) => {
      expect(readTeam(text)).toBeNull();
    },
  );
});

describe("decision 031 G: writeTeam", () => {
  it("given steps and a body, when written, then the front matter follows 031 G and the body is kept byte for byte", () => {
    const out = writeTeam(
      [
        step("test-writer", null, "", "writes the tests"),
        step("reviewer", "test-writer", "the verdict is ready", 'says "ok"'),
      ],
      "Body kept.\n  \n",
    );

    expect(out).toBe(
      `---
steps:
  - agent: test-writer
    does: "writes the tests"
  - agent: reviewer
    does: "says \\"ok\\""
    loop_to: test-writer
    until: "the verdict is ready"
---
Body kept.
  \n`,
    );
  });

  it("given a written file, when it is read back and parsed by the server, then the steps and the body are the same and parseTeam accepts it", () => {
    const steps = [
      step("a", null, "", "does: a thing"),
      step("b", "a", "until: done", "x"),
      step("c", "c", "again", "y"),
    ];
    const out = writeTeam(steps, "Some body\n");

    expect(readTeam(out)).toEqual({ steps, body: "Some body\n" });
    expect(parseTeam(out)).toEqual(["a", "b", "c"]);
  });

  it("given the text of a file read, when it is written back unchanged, then it is identical", () => {
    // The blank line between two steps is not kept by a rewrite: compare with the text without it.
    const canonical = TEXT.replace(
      "\n\n  - agent: reviewer",
      "\n  - agent: reviewer",
    );
    const read = readTeam(canonical);
    expect(read).not.toBeNull();
    expect(writeTeam(read?.steps ?? [], read?.body ?? "")).toBe(canonical);
  });

  it("given does and until written without quotes, as in the example of /dev-us, when it is read, then the values come back as written", () => {
    const read = readTeam(
      "---\nsteps:\n  - agent: doc-writer\n    does: writes the documentation\n    loop_to: doc-writer\n    until: the docs build\n---\n",
    );
    expect(read?.steps).toEqual([
      {
        agent: "doc-writer",
        does: "writes the documentation",
        loopTo: "doc-writer",
        until: "the docs build",
      },
    ]);
  });
});

describe("decision 031 G: the default steps", () => {
  it("given no file, when the draft starts, then it is test-writer, developer, reviewer looping to developer until the verdict is ready", () => {
    expect(DEFAULT_STEPS).toEqual([
      {
        agent: "test-writer",
        does: "writes the acceptance tests from the criteria; they must fail, for the right reason",
        loopTo: null,
        until: "",
      },
      {
        agent: "developer",
        does: "implements until those tests pass, without touching them",
        loopTo: null,
        until: "",
      },
      {
        agent: "reviewer",
        does: "reviews the diff with a fresh context",
        loopTo: "developer",
        until: "the verdict is ready",
        max: 3,
      },
    ]);
    expect(parseTeam(writeTeam(DEFAULT_STEPS, ""))).toEqual([
      "test-writer",
      "developer",
      "reviewer",
    ]);
  });
});

describe("decision 031 C: linking and reordering", () => {
  it("given linking a step to an earlier step, when linked, then its loop points there with the condition", () => {
    const out = linkSteps(abc(), "c", "a", "tests pass");

    expect(names(out)).toEqual(["a", "b", "c"]);
    expect(out[2]).toMatchObject({ loopTo: "a", until: "tests pass" });
  });

  it("given linking a step to itself, when linked, then its loop points to itself", () => {
    expect(linkSteps(abc(), "b", "b", "again")[1]).toMatchObject({
      loopTo: "b",
      until: "again",
    });
  });

  it("given a step that already loops, when it is linked elsewhere, then the new loop replaces the old one", () => {
    const out = linkSteps(
      [step("a"), step("b"), step("c", "a", "old")],
      "c",
      "b",
      "new",
    );

    expect(out[2]).toMatchObject({ loopTo: "b", until: "new" });
  });

  it("given linking A to a step after it, when linked, then that step moves right after A and no loop is added", () => {
    const out = linkSteps(
      [step("a"), step("b"), step("c"), step("d")],
      "a",
      "d",
    );

    expect(names(out)).toEqual(["a", "d", "b", "c"]);
    expect(out.every((s) => s.loopTo === null)).toBe(true);
  });

  it("given a loop that no longer points backwards after a link reorders, when linked, then that loop is removed", () => {
    // c loops to b; linking a to c puts c before b.
    const out = linkSteps(
      [step("a"), step("b"), step("c", "b", "ok")],
      "a",
      "c",
    );

    expect(names(out)).toEqual(["a", "c", "b"]);
    expect(out[1]).toMatchObject({ agent: "c", loopTo: null, until: "" });
  });

  it("given a step moved down, when it passes the step it loops to, then its loop is removed; a loop still pointing back stays", () => {
    // b loops to a; moving a down puts b first: b's loop to a points forward.
    const down = moveStep(
      [step("a"), step("b", "a", "ok"), step("c")],
      "a",
      "down",
    );
    expect(names(down)).toEqual(["b", "a", "c"]);
    expect(down[0]).toMatchObject({ loopTo: null, until: "" });

    // c loops to a; moving b up past a leaves c's loop backwards.
    const kept = moveStep(
      [step("a"), step("b"), step("c", "a", "ok")],
      "b",
      "up",
    );
    expect(names(kept)).toEqual(["b", "a", "c"]);
    expect(kept[2]).toMatchObject({ loopTo: "a", until: "ok" });
  });

  it("given the first step moved up or the last moved down, when moved, then nothing changes", () => {
    expect(names(moveStep(abc(), "a", "up"))).toEqual(["a", "b", "c"]);
    expect(names(moveStep(abc(), "c", "down"))).toEqual(["a", "b", "c"]);
  });

  it("given a step removed, when the loops pointing to it are looked at, then they are removed too", () => {
    const out = removeStep(
      [step("a"), step("b", "a", "ok"), step("c", "c", "again")],
      "a",
    );

    expect(names(out)).toEqual(["b", "c"]);
    expect(out[0]).toMatchObject({ loopTo: null, until: "" });
    expect(out[1]).toMatchObject({ loopTo: "c", until: "again" });
  });

  it("given an agent already in the team, when it is added, then it is a new last step with the free id 2 (decision 079 D5); a new agent is appended last", () => {
    expect(names(addStep(abc(), "b"))).toEqual(["a", "b", "c", "b"]);

    const out = addStep(abc(), "d", "does d");
    expect(names(out)).toEqual(["a", "b", "c", "d"]);
    expect(out[3]).toEqual({
      agent: "d",
      does: "does d",
      loopTo: null,
      until: "",
    });
  });

  it("given the functions, when they are called, then the array they are given is not modified", () => {
    const steps = abc();
    linkSteps(steps, "a", "c");
    moveStep(steps, "a", "down");
    removeStep(steps, "b");
    addStep(steps, "z");

    expect(names(steps)).toEqual(["a", "b", "c"]);
  });
});

const text = (...steps: string[]) =>
  `---\nsteps:\n${steps.join("\n")}\n---\nBody.\n`;
const roundTrip = (t: string) => {
  const read = readTeam(t);
  return read && writeTeam(read.steps, read.body);
};

describe("decision 079 A: the new keys", () => {
  it("given a team with id, parallel, loop_to, until and max, when it is read then written back, then the text is identical", () => {
    const ok = text(
      "  - agent: developer",
      '    does: "the screen"',
      "  - agent: developer",
      "    id: web",
      '    does: "the server"',
      "    parallel: true",
      "  - agent: reviewer",
      '    does: "reviews"',
      "    loop_to: web",
      '    until: "the verdict is ready"',
      "    max: 3",
    );
    // loop_to web (a step of the previous group) is allowed: the loop is on a later group.
    expect(readTeam(ok)?.steps).toEqual([
      {
        agent: "developer",
        does: "the screen",
        loopTo: null,
        until: "",
      },
      {
        agent: "developer",
        id: "web",
        does: "the server",
        loopTo: null,
        until: "",
        parallel: true,
      },
      {
        agent: "reviewer",
        does: "reviews",
        loopTo: "web",
        until: "the verdict is ready",
        max: 3,
      },
    ]);
    expect(roundTrip(ok)).toBe(ok);
  });

  it.each(["first", "all"])(
    "given a group head with `wait: %s`, when it is read then written, then the step has no wait and no wait line is written",
    (value) => {
      const old = text(
        "  - agent: a",
        `    wait: ${value}`,
        "  - agent: b",
        "    parallel: true",
      );
      const read = readTeam(old);

      expect(read?.steps).toHaveLength(2);
      expect(read?.steps[0]).not.toHaveProperty("wait");
      expect(writeTeam(read?.steps ?? [], read?.body ?? "")).toBe(
        text(
          "  - agent: a",
          '    does: ""',
          "  - agent: b",
          '    does: ""',
          "    parallel: true",
        ),
      );
    },
  );

  it("given an id equal to its agent, when written, then the id is not written", () => {
    const out = writeTeam([{ ...step("developer"), id: "developer" }], "");
    expect(out).not.toContain("id:");
  });

  it.each([
    [
      "two steps with the same key",
      ["  - agent: a", "  - agent: b", "    id: a"],
    ],
    ["parallel on the first step", ["  - agent: a", "    parallel: true"]],
    [
      "wait on a step not followed by a parallel step",
      ["  - agent: a", "    wait: first", "  - agent: b"],
    ],
    [
      "wait with another value",
      [
        "  - agent: a",
        "    wait: second",
        "  - agent: b",
        "    parallel: true",
      ],
    ],
    ["max 0", ["  - agent: a", "    loop_to: a", "    until: x", "    max: 0"]],
    [
      "max 10",
      ["  - agent: a", "    loop_to: a", "    until: x", "    max: 10"],
    ],
    [
      "max not an integer",
      ["  - agent: a", "    loop_to: a", "    until: x", "    max: 2.5"],
    ],
    ["max without loop_to", ["  - agent: a", "    max: 3"]],
    [
      "loop_to naming another step of its own group",
      [
        "  - agent: a",
        "  - agent: b",
        "    parallel: true",
        "  - agent: c",
        "    parallel: true",
        "    loop_to: b",
        "    until: x",
        "    max: 3",
      ],
    ],
    [
      "wait first on the middle step of a group",
      [
        "  - agent: a",
        "  - agent: b",
        "    parallel: true",
        "    wait: first",
        "  - agent: c",
        "    parallel: true",
      ],
    ],
    [
      "loop_to naming a later step",
      [
        "  - agent: a",
        "    loop_to: b",
        "    until: x",
        "    max: 3",
        "  - agent: b",
      ],
    ],
  ])(
    "given %s, when it is read, then it is not rewritable (null)",
    (_n, lines) => {
      expect(readTeam(text(...lines))).toBeNull();
    },
  );

  it("given a loop without max, when it is read, then it stays readable", () => {
    const t = text("  - agent: a", "    loop_to: a", '    until: "x"');
    expect(readTeam(t)?.steps[0]).toMatchObject({ loopTo: "a", until: "x" });
    expect(readTeam(t)?.steps[0]?.max).toBeUndefined();
  });
});

describe("decision 079 D5: the canvas gestures", () => {
  it("given steps a, b, c and a twice, when the agent is added again, then the new step has the free id 2, then 3, and keys stay unique", () => {
    const twice = addStep([step("developer")], "developer");
    expect(twice[1]).toMatchObject({ agent: "developer", id: "2" });
    const thrice = addStep(twice, "developer");
    expect(thrice[2]).toMatchObject({ agent: "developer", id: "3" });
    const keys = thrice.map((s) => s.id ?? s.agent);
    expect(new Set(keys).size).toBe(3);
  });

  it("given steps A, B, C, D in sequence, when a link is traced from A to D, then D joins in parallel the step that follows A", () => {
    const out = linkOnCanvas(
      [step("a"), step("b"), step("c"), step("d")],
      "a",
      "d",
    );

    expect(names(out)).toEqual(["a", "b", "d", "c"]);
    expect(out[2]?.parallel).toBe(true);
    expect(out[1]?.parallel).toBeFalsy();
    expect(out[3]?.parallel).toBeFalsy();
    expect(out.every((s) => s.loopTo === null)).toBe(true);
  });

  it.each([
    ["an earlier step", "c", "a"],
    ["itself", "c", "c"],
  ])(
    "given steps A, B, C, when a link is traced from C to %s, then it is a loop until the verdict is ready, at most 3 times",
    (_n, from, to) => {
      const out = linkOnCanvas([step("a"), step("b"), step("c")], from, to);

      expect(names(out)).toEqual(["a", "b", "c"]);
      expect(out[2]).toMatchObject({
        loopTo: to,
        until: "the verdict is ready",
        max: 3,
      });
    },
  );

  it("given A then B, when an agent X is inserted between them, then X is a step alone between A and B", () => {
    const out = insertStepAfter([step("a"), step("b")], "a", "x");

    expect(names(out)).toEqual(["a", "x", "b"]);
    expect(out[1]?.parallel).toBeFalsy();
    expect(out[2]?.parallel).toBeFalsy();
  });
});

const par = (agent: string, extra: Partial<TeamStep> = {}): TeamStep => ({
  ...step(agent),
  parallel: true,
  ...extra,
});
const loop = (
  agent: string,
  to: string,
  until = "the tests pass",
  max?: number,
): TeamStep => ({
  ...step(agent, to, until),
  ...(max === undefined ? {} : { max }),
});

describe("decision 079 D2: the summary", () => {
  it.each([
    [
      "one group of two and one loop",
      [step("a"), step("b"), par("c"), step("d"), loop("e", "d", "x", 3)],
      "5 étapes · 2 en parallèle · 1 boucle",
    ],
    [
      "two groups",
      [step("a"), par("b"), step("c"), par("d"), step("e"), step("f")],
      "6 étapes · 2 fois en parallèle",
    ],
    ["no group and no loop", [step("a"), step("b"), step("c")], "3 étapes"],
    [
      "two loops",
      [step("a"), loop("b", "a", "x", 3), loop("c", "a", "x", 3)],
      "3 étapes · 2 boucles",
    ],
  ])(
    "given %s, when summed up, then the text follows 079 D2",
    (_n, steps, expected) => {
      expect(teamSummary(steps)).toBe(expected);
    },
  );
});

describe("decision 079 D6: the checks", () => {
  const texts = (steps: TeamStep[]) => teamChecks(steps).map((c) => c.text);

  it("given a group, when checked, then the branches join before the next step, or before Fin when last", () => {
    expect(texts([step("a"), step("b"), par("c"), step("d")])).toContain(
      "Les branches b et c se rejoignent avant d",
    );
    expect(texts([step("a"), par("b")])).toContain(
      "Les branches a et b se rejoignent avant Fin",
    );
  });

  it("given loops, when checked, then the limit, the missing condition and the missing limit are said", () => {
    const ok = teamChecks([step("a"), loop("b", "a", "x", 3)]);
    expect(
      ok.find((c) => c.text === "La boucle de b a une limite : 3 fois")?.ok,
    ).toBe(true);
    const noUntil = teamChecks([step("a"), loop("b", "a", "", 3)]);
    expect(
      noUntil.find((c) => c.text === "La boucle de b n'a pas de condition")?.ok,
    ).toBe(false);
    const noMax = teamChecks([step("a"), loop("b", "a", "x")]);
    expect(
      noMax.find((c) => c.text === "La boucle de b n'a pas de limite")?.ok,
    ).toBe(false);
  });

  it("given a step with an id, when labelled, then it reads agent · id", () => {
    expect(stepLabel({ ...step("developer"), id: "web" })).toBe(
      "developer · web",
    );
    expect(stepLabel(step("developer"))).toBe("developer");
  });
});

describe("decision 079 C: the conditions", () => {
  it.each([
    ["the verdict is ready", "Si le reviewer bloque"],
    ["the tests pass", "Si les tests échouent"],
    ["always", "Toujours"],
    ["when the docs build", "Une condition à toi"],
  ])(
    "given until %j, when its choice is looked up, then it is %s",
    (until, label) => {
      expect(untilChoice(until, "reviewer")).toBe(label);
    },
  );
});
