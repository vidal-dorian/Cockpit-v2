import { describe, expect, it } from "vitest";
import {
  addParallelTo,
  groupsOf,
  insertAtGroup,
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
  it("given a group head removed, when the group has other steps, then the next one heads it", () => {
    const out = removeStep([step("a"), par("b"), par("c")], "a");

    expect(shape(out)).toEqual([["b", "c"]]);
    expect(out[0]?.parallel).toBeFalsy();
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

describe("feedback on E6: the place where an agent is dropped", () => {
  it("given three groups, when an agent is inserted at group 0, then it comes first alone and the old head keeps no parallel", () => {
    const out = insertAtGroup([step("a"), par("b"), step("c")], 0, "x");

    expect(shape(out)).toEqual([["x"], ["a", "b"], ["c"]]);
    expect(out[1]?.parallel).toBeFalsy();
    expect(out[2]?.parallel).toBe(true);
  });

  it("given three groups, when an agent is inserted at group 1, then it is alone between the first and the second group", () => {
    const out = insertAtGroup([step("a"), step("b"), par("c")], 1, "x", "does");

    expect(shape(out)).toEqual([["a"], ["x"], ["b", "c"]]);
    expect(out[1]?.does).toBe("does");
    expect(out[2]?.parallel).toBeFalsy();
    expect(out[3]?.parallel).toBe(true);
  });

  it("given two groups, when the index is the number of groups or more, then the agent is the last step", () => {
    const steps = [step("a"), par("b"), step("c")];

    expect(names(insertAtGroup(steps, 3, "x"))).toEqual(["a", "b", "c", "x"]);
    expect(names(insertAtGroup(steps, 99, "x"))).toEqual(["a", "b", "c", "x"]);
    expect(shape(insertAtGroup(steps, 99, "x"))).toEqual([
      ["a", "b"],
      ["c"],
      ["x"],
    ]);
  });

  it("given an agent already in the team, when it is inserted, then it gets the free id 2 then 3", () => {
    const once = insertAtGroup([step("a"), step("b")], 1, "a");
    const twice = insertAtGroup(once, 0, "a");

    expect(once[1]?.id).toBe("2");
    expect(twice[0]?.id).toBe("3");
    expect(twice[0]?.agent).toBe("a");
  });

  it("given a loop, when an agent is inserted before its target, then the loop still points to its key", () => {
    const out = insertAtGroup(
      [step("a"), step("b", { loopTo: "a", until: "ok", max: 2 })],
      0,
      "x",
    );

    expect(out.find((s) => s.agent === "b")?.loopTo).toBe("a");
    expect(names(out)).toEqual(["x", "a", "b"]);
  });
});

describe("feedback on E6: an agent dropped on a step to run in parallel", () => {
  it("given a step alone, when an agent is added in parallel, then the two form a group", () => {
    const out = addParallelTo([step("a"), step("b")], "a", "x");

    expect(shape(out)).toEqual([["a", "x"], ["b"]]);
    expect(out[1]?.parallel).toBe(true);
  });

  it("given a group, when an agent is added in parallel to one member, then it goes after the last step of the group", () => {
    const out = addParallelTo([step("a"), par("b"), step("c")], "a", "x", "d");

    expect(names(out)).toEqual(["a", "b", "x", "c"]);
    expect(out[2]).toMatchObject({ parallel: true, does: "d" });
  });

  it("given an agent already in the team, when it is added in parallel, then it gets the free id 2", () => {
    const out = addParallelTo([step("a")], "a", "a");

    expect(out[1]).toMatchObject({ agent: "a", id: "2", parallel: true });
  });

  it("given an unknown key, when an agent is added in parallel, then the steps are unchanged", () => {
    const steps = [step("a"), step("b")];

    expect(addParallelTo(steps, "nope", "x")).toEqual(steps);
  });
});
