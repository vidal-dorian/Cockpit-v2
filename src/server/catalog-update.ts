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
/** `/analyser` and its agents (decisions 043 M and 047 M): prepared with the rest, but no team agent. */
export const ANALYSER_FILES = [
  "agents/cartographer.md",
  "agents/rules-analyst.md",
  "skills/analyser/SKILL.md",
].map(catalogFile);

// Decision 049 C: the files that can be updated are the catalogue's, CLAUDE.md apart.
export const CATALOG_TEXTS = new Map(
  [...CATALOG_FILES, ...ANALYSER_FILES].map((f) => [f.path, f.content]),
);
const PATHS = [...CATALOG_TEXTS.keys()];
const DEV_US = ".claude/skills/dev-us/SKILL.md";
/** The SHA-256 of the past versions of each file, by repo path (decision 049 B, `npm run catalog:history`). */
export const HISTORY: Record<string, string[]> = JSON.parse(
  fromCatalog("history.json"),
);

export const isCatalogPath = (path: string) => CATALOG_TEXTS.has(path);
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

export type CatalogState = "current" | "old" | "modified" | "absent";
type Hashes = Record<string, string>;

/** Decision 049 D: the state of one file of the catalogue, from its text in the repo (null when absent). */
export function fileState(
  path: string,
  text: string | null,
  recorded: Hashes,
  history: Record<string, string[]>,
): CatalogState {
  if (text === null) return "absent";
  if (text === CATALOG_TEXTS.get(path)) return "current";
  const hash = sha256(text);
  return recorded[path] === hash || history[path]?.includes(hash)
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
  return PATHS.map((path) => ({
    path,
    state: fileState(path, files[path] ?? null, recorded, history),
  }));
}

type Inspect = Awaited<
  ReturnType<ReturnType<typeof githubClient>["fileReader"]>
>["inspect"];

/** The catalogue files of a repo at a commit, one read per file present (decision 049 H). A path that is not a plain readable file counts as a text no version has, so as modified. */
export async function readCatalogFiles(inspect: Inspect, sha: string) {
  const read = await Promise.all(
    PATHS.map(async (path) => {
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
    const hash = sha256(CATALOG_TEXTS.get(path) as string);
    await tx
      .insert(catalogWrites)
      .values({ projectId, path, sha256: hash })
      .onConflictDoUpdate({
        target: [catalogWrites.projectId, catalogWrites.path],
        set: { sha256: hash, writtenAt: new Date() },
      });
  }
}
