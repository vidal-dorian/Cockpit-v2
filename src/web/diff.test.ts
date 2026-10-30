import { describe, expect, it } from "vitest";
import { diffLines } from "./diff.ts";

// Decision 025 E (slice 5.2): the line-by-line diff of the body of an issue, a pure function tested alone.
// Pinned here (the decision leaves them open):
// - `diffLines(before: string, after: string)` is exported by src/web/diff.ts. `before` is the version of Cockpit, `after` the one of GitHub.
// - It returns the lines in order as `{ type: "same" | "removed" | "added", text: string }[]`: a removed line is only in `before`,
//   an added line only in `after`. In a changed stretch the removed lines come first, then the added ones.
// - Lines are split on "\n"; a blank line is a line; an empty text has no line at all.
// - Over 2,000 lines on either side it does not compute a diff: it returns null, and the caller shows both versions.
//   Exactly 2,000 lines on each side still gives a diff.
// - The diff is minimal: the lines kept are a longest common subsequence.

type Line = NonNullable<ReturnType<typeof diffLines>>[number];

const lines = (before: string, after: string) => {
  const result = diffLines(before, after);
  expect(result, "a diff, not the fallback").not.toBeNull();
  return result as Line[];
};
const as = (type: Line["type"], text: string): Line => ({ type, text });
/** Whatever the diff is, it must rebuild both texts. */
const rebuilt = (result: Line[]) => ({
  before: result.filter((l) => l.type !== "added").map((l) => l.text),
  after: result.filter((l) => l.type !== "removed").map((l) => l.text),
});
const numbered = (n: number, prefix = "ligne") =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i}`);

describe("criterion E: diffLines", () => {
  it("given identical texts, when they are compared, then every line is the same, in order", () => {
    expect(lines("a\nb\nc", "a\nb\nc")).toEqual([
      as("same", "a"),
      as("same", "b"),
      as("same", "c"),
    ]);
  });

  it("given a line added in the middle, when they are compared, then it is added and the others are the same, in order", () => {
    expect(lines("a\nc", "a\nb\nc")).toEqual([
      as("same", "a"),
      as("added", "b"),
      as("same", "c"),
    ]);
  });

  it("given a line removed in the middle, when they are compared, then it is removed and the others are the same, in order", () => {
    expect(lines("a\nb\nc", "a\nc")).toEqual([
      as("same", "a"),
      as("removed", "b"),
      as("same", "c"),
    ]);
  });

  it("given a line replaced, when they are compared, then the removed line comes before the added one", () => {
    expect(lines("a\nb\nc", "a\nB\nc")).toEqual([
      as("same", "a"),
      as("removed", "b"),
      as("added", "B"),
      as("same", "c"),
    ]);
  });

  it("given lines added at the start and the end, when they are compared, then they are added where they are", () => {
    expect(lines("b", "a\nb\nc")).toEqual([
      as("added", "a"),
      as("same", "b"),
      as("added", "c"),
    ]);
  });

  it("given several changes far apart, when they are compared, then each is where it belongs", () => {
    expect(lines("1\n2\n3\n4\n5\n6", "1\nTWO\n3\n4\n6\n7")).toEqual([
      as("same", "1"),
      as("removed", "2"),
      as("added", "TWO"),
      as("same", "3"),
      as("same", "4"),
      as("removed", "5"),
      as("same", "6"),
      as("added", "7"),
    ]);
  });

  it("given blank lines, when they are compared, then a blank line is a line like another", () => {
    expect(lines("a\n\nb", "a\nb")).toEqual([
      as("same", "a"),
      as("removed", ""),
      as("same", "b"),
    ]);
  });

  it("given a repeated line, when one of its copies is dropped, then exactly one line is removed and the others are the same", () => {
    const result = lines("a\na\nb", "a\nb");

    expect(result.filter((l) => l.type === "removed")).toEqual([
      as("removed", "a"),
    ]);
    expect(result.filter((l) => l.type === "same")).toHaveLength(2);
    expect(result.filter((l) => l.type === "added")).toEqual([]);
    expect(rebuilt(result)).toEqual({
      before: ["a", "a", "b"],
      after: ["a", "b"],
    });
  });

  it("given two texts with nothing in common, when they are compared, then every line of the first is removed and every line of the second added", () => {
    expect(lines("a\nb", "c\nd")).toEqual([
      as("removed", "a"),
      as("removed", "b"),
      as("added", "c"),
      as("added", "d"),
    ]);
  });

  it("given an empty text on one side, when they are compared, then the other side is all added or all removed", () => {
    expect(lines("", "a\nb")).toEqual([as("added", "a"), as("added", "b")]);
    expect(lines("a\nb", "")).toEqual([as("removed", "a"), as("removed", "b")]);
  });

  it("given two empty texts, when they are compared, then there is no line", () => {
    expect(lines("", "")).toEqual([]);
  });

  it("given the text of an issue and a copy with a few lines changed, when they are compared, then both texts can be rebuilt from the result", () => {
    const before = [
      "# Titre",
      "",
      "En tant que a, je veux b.",
      "",
      "- [ ] un",
      "- [ ] deux",
      "",
      "pied",
    ].join("\n");
    const after = [
      "# Titre",
      "",
      "En tant que a, je veux c.",
      "",
      "- [ ] un",
      "- [ ] trois",
      "- [ ] quatre",
      "",
      "pied",
    ].join("\n");

    const result = lines(before, after);

    expect(rebuilt(result)).toEqual({
      before: before.split("\n"),
      after: after.split("\n"),
    });
    expect(result.filter((l) => l.type === "same").map((l) => l.text)).toEqual([
      "# Titre",
      "",
      "",
      "- [ ] un",
      "",
      "pied",
    ]);
  });

  it("given 2,000 lines on each side with one changed, when they are compared, then it is still a diff", () => {
    const before = numbered(2_000);
    const after = [...before];
    after[1_000] = "changée";

    const result = lines(before.join("\n"), after.join("\n"));

    expect(result.filter((l) => l.type !== "same")).toEqual([
      as("removed", "ligne 1000"),
      as("added", "changée"),
    ]);
    expect(result).toHaveLength(2_001);
  });

  it.each([
    ["before", numbered(2_001).join("\n"), numbered(3).join("\n")],
    ["after", numbered(3).join("\n"), numbered(2_001).join("\n")],
    ["both", numbered(2_001).join("\n"), numbered(2_001, "autre").join("\n")],
    ["after, with nothing before", "", numbered(2_001).join("\n")],
  ])(
    "given more than 2,000 lines on the %s side, when they are compared, then there is no diff (null)",
    (_side, before, after) => {
      expect(diffLines(before, after)).toBeNull();
    },
  );
});
