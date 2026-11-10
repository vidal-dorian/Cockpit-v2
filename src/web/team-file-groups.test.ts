import { describe, expect, it } from "vitest";
import {
  groupsOf,
  insertStepAfter,
  linkOnCanvas,
  moveStep,
  parseMax,
  removeStep,
  type TeamStep,
  tidy,
} from "./team-file.ts";

// Slice E6 (decision 079): what a group does to the draft functions, beyond the acceptance tests of team-file.test.ts.

const step = (agent: string, extra: Partial<TeamStep> = {}): TeamStep => ({
  agent,
  does: "",
  loopTo: null,
  until: "",
  ...extra,
});
const par = (agent: string, extra: Partial<TeamStep> = {}) =>
  step(agent, { parallel: true, ...extra });
const names = (steps: TeamStep[]) => steps.map((s) => s.agent);
const shape = (steps: TeamStep[]) =>
  groupsOf(steps).map((g) => g.map((s) => s.agent));

describe("decision 079: groups in the draft", () => {
  it("given a group head removed, when the group has other steps, then the next one heads it and takes the wait", () => {
    const out = removeStep(
      [step("a", { wait: "first" }), par("b"), par("c")],
      "a",
    );

    expect(shape(out)).toEqual([["b", "c"]]);
    expect(out[0]?.parallel).toBeFalsy();
    expect(out[0]?.wait).toBe("first");
  });

  it("given a step moved inside a group, when it swaps with its neighbour, then the shape of the groups stays", () => {
    const out = moveStep([step("a"), step("b"), par("c")], "b", "down");

    expect(names(out)).toEqual(["a", "c", "b"]);
    expect(shape(out)).toEqual([["a"], ["c", "b"]]);
  });

  it("given a link from A to a step two groups further, when traced, then it joins the group that follows A, after its last step", () => {
    const out = linkOnCanvas(
      [step("a"), step("b"), par("c"), step("d"), step("e")],
      "a",
      "e",
    );

    expect(shape(out)).toEqual([["a"], ["b", "c", "e"], ["d"]]);
  });

  it("given a link to the next step or into the same group, when traced, then nothing changes", () => {
    const steps = [step("a"), step("b"), par("c")];

    expect(linkOnCanvas(steps, "a", "b")).toBe(steps);
    expect(linkOnCanvas(steps, "c", "b")).toBe(steps);
  });

  it("given a step that heads a group moved to join another, when it leaves, then its group keeps its members", () => {
    const out = linkOnCanvas(
      [step("a"), step("b"), step("c"), par("d")],
      "a",
      "c",
    );

    expect(shape(out)).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("given a group, when a step is inserted after one of its members, then it is alone after the whole group", () => {
    const out = insertStepAfter([step("a"), par("b"), step("c")], "a", "x");

    expect(shape(out)).toEqual([["a", "b"], ["x"], ["c"]]);
  });

  it("given a loop into its own group, when the draft is tidied, then the loop and its max go", () => {
    const out = tidy([
      step("a"),
      par("b", { loopTo: "a", until: "x", max: 3 }),
    ]);

    expect(out[1]).toMatchObject({ loopTo: null, until: "" });
    expect(out[1]?.max).toBeUndefined();
  });

  it("given a wait that is not on a group head, when the draft is tidied, then it goes", () => {
    const out = tidy([step("a", { wait: "first" }), step("b")]);

    expect(out[0]?.wait).toBeUndefined();
  });
});

describe("decision 079 C: the number of « Au plus »", () => {
  it.each([
    ["", undefined],
    ["abc", undefined],
    ["0", 1],
    ["5", 5],
    ["12", 9],
  ])("given %j, when read, then it is %s", (value, expected) => {
    expect(parseMax(value)).toBe(expected);
  });
});
