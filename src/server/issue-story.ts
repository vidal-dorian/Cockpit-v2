import { z } from "zod";
import { criterionText, narrative } from "./tickets.ts";

// Decision 057 B: is an issue written as a user story? Pure; every search below is a linear scan (no nested lazy regex), the body is a stranger's text.

const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u;

const story = z.object({
  asA: narrative,
  iWant: narrative,
  soThat: narrative,
  criteria: z
    .array(
      z.object({
        given: criterionText,
        when: criterionText,
        // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the API (decision 017)
        then: criterionText,
      }),
    )
    .min(1)
    .max(20),
});

/** The text cut at the first match of each separator, one after the other, after the opening keyword; null when one is missing. */
function cut(text: string, start: RegExp, ...separators: RegExp[]) {
  const opening = start.exec(text);
  if (!opening) return null;
  let rest = text.slice(opening[0].length);
  const parts: string[] = [];
  for (const separator of separators) {
    const found = separator.exec(rest);
    if (!found) return null;
    parts.push(rest.slice(0, found.index));
    rest = rest.slice(found.index + found[0].length);
  }
  return [...parts, rest].map((part) =>
    part.trim().replace(/,$/u, "").replace(/\.$/u, ""),
  );
}

const NARRATIVES = [
  [/^en tant que\s+/iu, /\s+je veux\s+/iu, /\s+afin d(?:e\s+|')/iu],
  [/^as an?\s+/iu, /\s+i want\s+/iu, /\s+so that\s+/iu],
] as const;
const CRITERIA = [
  [/^[ée]tant donn[ée]\s+/iu, /\s+quand\s+/iu, /\s+alors\s+/iu],
  [/^given\s+/iu, /\s+when\s+/iu, /\s+then\s+/iu],
] as const;
// The next lines of a criterion written on three lines.
const NEXT = [
  [/^quand\s+/iu, /^alors\s+/iu],
  [/^when\s+/iu, /^then\s+/iu],
] as const;

function readNarrative(lines: string[]) {
  for (let i = 0; i < lines.length; i++) {
    // « afin de » may be two lines further down; a blank line ends the paragraph.
    let text = (lines[i] ?? "").replace(BULLET, "");
    for (let k = 1; k <= 3; k++) {
      for (const [a, b, c] of NARRATIVES) {
        const found = cut(text, a, b, c);
        if (found) return found;
      }
      const next = (lines[i + k] ?? "").trim();
      if (!next) break;
      text = `${text} ${next}`;
    }
  }
  return null;
}

function readCriteria(lines: string[]) {
  const criteria: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = (lines[i] ?? "").replace(BULLET, "").trim();
    const one = CRITERIA.map(([a, b, c]) => cut(text, a, b, c)).find(Boolean);
    if (one) {
      criteria.push(one);
      continue;
    }
    const at = CRITERIA.findIndex(([a]) => a.test(text));
    const [when, then] = NEXT[at] ?? [];
    const lineWhen = (lines[i + 1] ?? "").trim();
    const lineThen = (lines[i + 2] ?? "").trim();
    if (when?.test(lineWhen) && then?.test(lineThen)) {
      const [given] = cut(text, CRITERIA[at]?.[0] as RegExp) ?? [];
      criteria.push([
        given ?? "",
        ...[lineWhen.replace(when, ""), lineThen.replace(then, "")].map((p) =>
          p.trim().replace(/[,.]$/u, ""),
        ),
      ]);
      i += 2;
    }
  }
  return criteria;
}

/** The user story an issue body is written as (decision 057 B), or null when it is a ticket: no narrative, no criterion, or over the limits of `create_user_stories`. */
export function readStoryIssue(body: string) {
  // Runs of whitespace are collapsed first, so `\s+` never scans a long run again and again.
  const lines = body
    .replaceAll("**", "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " "));
  const [asA, iWant, soThat] = readNarrative(lines) ?? [];
  const parsed = story.safeParse({
    asA,
    iWant,
    soThat,
    criteria: readCriteria(lines).map(([given, when, then]) => ({
      given,
      when,
      then,
    })),
  });
  return parsed.success ? parsed.data : null;
}
