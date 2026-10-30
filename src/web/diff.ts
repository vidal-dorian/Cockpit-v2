export type DiffLine = { type: "same" | "removed" | "added"; text: string };

// Over this many lines on a side the table below would be too big (4 million cells): the caller shows both versions instead.
const MAX_LINES = 2_000;

/** The lines of two texts, in order, marked removed (only in `before`), added (only in `after`) or same: the same lines are a longest common subsequence (decision 025 E). Null over 2,000 lines on a side. */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null;

  // lcs[i][j]: the length of the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  const at = (i: number, j: number) => lcs[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      (lcs[i] as number[])[j] =
        a[i] === b[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));

  // Walks the table from the start; a removed line goes before an added one when both are possible.
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ type: "same", text: a[i++] as string });
      j++;
    } else if (
      i < a.length &&
      (j === b.length || at(i + 1, j) >= at(i, j + 1))
    ) {
      lines.push({ type: "removed", text: a[i++] as string });
    } else {
      lines.push({ type: "added", text: b[j++] as string });
    }
  }
  return lines;
}
