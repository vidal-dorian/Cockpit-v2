import { describe, expect, it } from "vitest";
import { parseTeam } from "../server/team.ts";
import {
  addStep,
  DEFAULT_STEPS,
  linkSteps,
  moveStep,
  readTeam,
  removeStep,
  type TeamStep,
  writeTeam,
} from "./team-file.ts";

// Slice E3 (decision 031 C, G): the pure reader, writer and draft functions of `.claude/team.md`, `src/web/team-file.ts`.
//
// Pinned where the decision leaves it open:
// - A step is `{ agent, does, loopTo, until }`: `does` and `until` strings ("" when absent), `loopTo` an agent name or null.
// - `readTeam(text)` is `{ steps, body }` (body: everything after the closing `---` line, after its line break), or `null` when Cockpit cannot rewrite the file without loss.
// - `writeTeam(steps, body)` returns the whole file text: the front matter of 031 G, then `body` byte for byte. `does` is always written, `loop_to` and `until` only for a step with a loop.
// - `DEFAULT_STEPS` is the draft without a file (029 C).
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

  it("given an agent already in the team, when it is added, then nothing changes; a new agent is appended last", () => {
    expect(names(addStep(abc(), "b"))).toEqual(["a", "b", "c"]);

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
