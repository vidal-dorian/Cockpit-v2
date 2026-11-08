import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Tx } from "./action.ts";
import type { Db } from "./db/db.ts";
import { catalogWrites } from "./db/schema.ts";
import type { githubClient } from "./github.ts";

const fromCatalog = (file: string) =>
  readFileSync(new URL(`../../catalog/${file}`, import.meta.url), "utf8");
const catalogFile = (file: string) => ({
  path: `.claude/${file}`,
  content: fromCatalog(file),
});

/** Where each file of `catalog/` goes in a repo (decision 027 B): the team agents (offered by the agents page too) and the dev and write skills. */
export const CATALOG_FILES = [
  "agents/test-writer.md",
  "agents/developer.md",
  "agents/reviewer.md",
  "skills/dev-us/SKILL.md",
  "skills/write-us/SKILL.md",
].map(catalogFile);
/** `/analyser` and its agents (decisions 043 M, 047 M, 051 K and 052 K): prepared with the rest, but no team agent. */
export const ANALYSER_FILES = [
  "agents/cartographer.md",
  "agents/rules-analyst.md",
  "agents/bug-hunter.md",
  "agents/security-reviewer.md",
  "agents/architect.md",
  "agents/upgrade-advisor.md",
  "skills/analyser/SKILL.md",
].map(catalogFile);

/** The doc agents (decision 063 C): written by the Premium and Max teams only, so apart from the files a Standard preparation writes. */
export const DOC_FILES = ["agents/doc-writer.md", "agents/doc-reviewer.md"].map(
  catalogFile,
);
const DOC_PATHS = DOC_FILES.map((f) => f.path);

// Decision 049 C: the files that can be updated are the catalogue's, CLAUDE.md apart.
export const CATALOG_TEXTS = new Map(
  [...CATALOG_FILES, ...ANALYSER_FILES].map((f) => [f.path, f.content]),
);
const PATHS = [...CATALOG_TEXTS.keys()];
/** Every text of the catalogue a repo may hold: the files above and the doc agents. */
export const KNOWN_TEXTS = new Map([
  ...CATALOG_TEXTS,
  ...DOC_FILES.map((f) => [f.path, f.content] as const),
]);
export const DEV_US = ".claude/skills/dev-us/SKILL.md";
/** The SHA-256 of the past versions of each file, by repo path (decision 049 B, `npm run catalog:history`). */
export const HISTORY: Record<string, string[]> = JSON.parse(
  fromCatalog("history.json"),
);

export const isCatalogPath = (path: string) => KNOWN_TEXTS.has(path);
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

export type CatalogState = "current" | "old" | "modified" | "absent";
type Hashes = Record<string, string>;

// Decision 051 L: the `model:` line of an agent is the user's choice (the agents tab), so it never makes a copy differ from the catalogue.
const MODEL = /^model:.*\r?\n/m;
const MODEL_LINES = [
  ...["sonnet", "opus", "haiku", "fable", "inherit"].map(
    (m) => `model: ${m}\n`,
  ),
  "",
];
/** The front matter without its closing fence, and what follows it. */
const frontMatter = (text: string) => {
  const found = /^---\r?\n[\s\S]*?\r?\n(?=---\r?\n)/.exec(text);
  return found && { head: found[0], rest: text.slice(found[0].length) };
};
const modelLine = (text: string) =>
  frontMatter(text)?.head.match(MODEL)?.[0] ?? "";
/** `text` with the `model:` line `line` (none for "") put last in its front matter. */
const withModelLine = (text: string, line: string) => {
  const front = frontMatter(text);
  return front ? front.head.replace(MODEL, "") + line + front.rest : text;
};

/** What « Mettre à jour » writes for a file: the catalogue's text with the model line the repo's copy has (or none, when it has a front matter), decision 051 L. */
export const textToWrite = (path: string, before: string | null) => {
  const text = KNOWN_TEXTS.get(path) as string;
  // A copy with no front matter says nothing of a model: the catalogue's is kept.
  return before !== null && frontMatter(before)
    ? withModelLine(text, modelLine(before))
    : text;
};

/** Decision 049 D: the state of one file of the catalogue, from its text in the repo (null when absent). The model line is not compared (051 L). */
export function fileState(
  path: string,
  text: string | null,
  recorded: Hashes,
  history: Record<string, string[]>,
): CatalogState {
  if (text === null) return "absent";
  const catalogue = KNOWN_TEXTS.get(path) as string;
  if (text === catalogue) return "current";
  if (withModelLine(text, "") === withModelLine(catalogue, ""))
    return "current";
  // The copy with each model line a version of the catalogue may have had (not only today's): what it looked like before the user chose a model.
  return [
    text,
    ...[modelLine(catalogue), ...MODEL_LINES].map((line) =>
      withModelLine(text, line),
    ),
  ]
    .map(sha256)
    .some((hash) => recorded[path] === hash || history[path]?.includes(hash))
    ? "old"
    : "modified";
}

/** Whether `text` is an original, past version of a file of the catalogue (never CLAUDE.md): the only kind of copy that is replaced. */
export const isOldCopy = (path: string, text: string, recorded: Hashes) =>
  isCatalogPath(path) && fileState(path, text, recorded, HISTORY) === "old";

/** Decision 049 D: the state of every file of the catalogue in a repo; `files` maps a repo path to its text (null or missing: absent). Null when the repo is not prepared (no dev-us skill). */
export function catalogStates({
  files,
  recorded = {},
  history = HISTORY,
}: {
  files: Record<string, string | null | undefined>;
  recorded?: Hashes;
  history?: Record<string, string[]>;
}) {
  if (files[DEV_US] == null) return null;
  // The doc agents only when the repo has them (a Standard project never wrote them).
  return [...PATHS, ...DOC_PATHS.filter((path) => files[path] != null)].map(
    (path) => ({
      path,
      state: fileState(path, files[path] ?? null, recorded, history),
    }),
  );
}

type Inspect = Awaited<
  ReturnType<ReturnType<typeof githubClient>["fileReader"]>
>["inspect"];

/** The catalogue files of a repo at a commit, one read per file present (decision 049 H). A path that is not a plain readable file counts as a text no version has, so as modified. */
export async function readCatalogFiles(
  inspect: Inspect,
  sha: string,
  withDocAgents = false,
) {
  const read = await Promise.all(
    // shortcut: the health line does not look for the doc agents (two reads more on each display); only the update plan does. Add them there if a stale doc agent must show up in the health.
    (withDocAgents ? [...PATHS, ...DOC_PATHS] : PATHS).map(async (path) => {
      const found = await inspect(path, sha);
      return [path, found && (found.text ?? "")] as const;
    }),
  );
  return Object.fromEntries(read);
}

/** What Cockpit kept of the files it wrote in a project (decision 049 A), by path. */
export async function recordedHashes(db: Db, projectId: number) {
  const found = await db
    .select({ path: catalogWrites.path, sha256: catalogWrites.sha256 })
    .from(catalogWrites)
    .where(eq(catalogWrites.projectId, projectId));
  return Object.fromEntries(found.map((row) => [row.path, row.sha256]));
}

/** Keeps the hash of the catalogue text of each written path (CLAUDE.md and anything else is ignored), in the transaction of the history entry. */
export async function recordWrites(tx: Tx, projectId: number, paths: string[]) {
  for (const path of paths.filter(isCatalogPath)) {
    const hash = sha256(KNOWN_TEXTS.get(path) as string);
    await tx
      .insert(catalogWrites)
      .values({ projectId, path, sha256: hash })
      .onConflictDoUpdate({
        target: [catalogWrites.projectId, catalogWrites.path],
        set: { sha256: hash, writtenAt: new Date() },
      });
  }
}
