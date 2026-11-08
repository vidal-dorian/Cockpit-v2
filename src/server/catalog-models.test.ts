import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogStates } from "./catalog-update.ts";
import { withProject } from "./test-mcp.ts";

// Slice R5 (decision 051 L, changing the model of an agent without cutting the updates of decision 049 D and F):
// - the line `model:` of the front matter does not count when a copy is compared with the catalogue: a copy that differs from a version only by that line (changed, or removed
//   for « Celui de la session ») is `current` when that version is the current one, `old` when it is a past one (recorded or in the history), never `modified`;
//   a copy that differs by anything else too stays `modified`;
// - « Mettre à jour » (POST /api/projects/:id/catalog/apply) keeps the model line of the repo's copy (or its absence) when it writes the new version, everything else being the catalogue's.
// The catalogue is read from the disk here, so these tests do not depend on how many files it holds.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const catalogDir = fileURLToPath(new URL("../../catalog/", import.meta.url));
const fromCatalog = (relative: string) =>
  readFileSync(`${catalogDir}${relative}`, "utf8");
/** Every file of the catalogue but CLAUDE.md, by repo path. */
const CATALOG: Record<string, string> = Object.fromEntries([
  ...readdirSync(`${catalogDir}agents`).map((f) => [
    `.claude/agents/${f}`,
    fromCatalog(`agents/${f}`),
  ]),
  ...readdirSync(`${catalogDir}skills`).map((d) => [
    `.claude/skills/${d}/SKILL.md`,
    fromCatalog(`skills/${d}/SKILL.md`),
  ]),
]);
const DEV = ".claude/agents/developer.md";
const REVIEWER = ".claude/agents/reviewer.md";
const DEV_US = ".claude/skills/dev-us/SKILL.md";
const MODEL = /^model:.*$/m;

const withModel = (text: string, model: string) =>
  text.replace(MODEL, `model: ${model}`);
const withoutModel = (text: string) => text.replace(/^model:.*\n/m, "");
/** A version of the file from the past: the same model, one more line in the body. */
const pastOf = (text: string) => `${text}\nA sentence an older version had.\n`;
const stateOf = (
  result: ReturnType<typeof catalogStates>,
  path: string,
): string | undefined => result?.find((f) => f.path === path)?.state;
const prepared = (changes: Record<string, string>) => ({
  [DEV_US]: CATALOG[DEV_US] as string,
  ...changes,
});

describe("decision 051 L: the model line does not make a copy modified", () => {
  it("given the current developer with another model, when the states are computed, then it is current, whatever the model written", () => {
    for (const model of ["opus", "haiku", "fable"])
      expect(
        stateOf(
          catalogStates({
            files: prepared({
              [DEV]: withModel(CATALOG[DEV] as string, model),
            }),
          }),
          DEV,
        ),
        model,
      ).toBe("current");
  });

  it("given the current developer with no model line (the model of the session), when the states are computed, then it is current", () => {
    const result = catalogStates({
      files: prepared({ [DEV]: withoutModel(CATALOG[DEV] as string) }),
    });

    expect(stateOf(result, DEV)).toBe("current");
  });

  it("given the same for the agents of the analysis, when the states are computed, then each is current with another model", () => {
    const names = [
      "cartographer",
      "rules-analyst",
      "bug-hunter",
      "security-reviewer",
      "architect",
    ];
    for (const n of names)
      expect(
        CATALOG[`.claude/agents/${n}.md`],
        `${n} is in the catalogue`,
      ).toBeDefined();
    const files = prepared(
      Object.fromEntries(
        names.map((n) => [
          `.claude/agents/${n}.md`,
          withModel(CATALOG[`.claude/agents/${n}.md`] as string, "haiku"),
        ]),
      ),
    );

    const result = catalogStates({ files });

    for (const n of names)
      expect(stateOf(result, `.claude/agents/${n}.md`), n).toBe("current");
  });

  it("given a past version in the history with another model chosen by the user, when the states are computed, then it is old", () => {
    const past = pastOf(CATALOG[DEV] as string);

    const result = catalogStates({
      files: prepared({ [DEV]: withModel(past, "opus") }),
      history: { [DEV]: [sha256(past)] },
    });

    expect(stateOf(result, DEV)).toBe("old");
  });

  it("given a past version Cockpit recorded when it wrote it, with the model removed by the user, when the states are computed, then it is old", () => {
    const past = pastOf(CATALOG[DEV] as string);

    const result = catalogStates({
      files: prepared({ [DEV]: withoutModel(past) }),
      recorded: { [DEV]: sha256(past) },
      history: {},
    });

    expect(stateOf(result, DEV)).toBe("old");
  });

  it("given a copy with another model and one line of its own more, when the states are computed, then it is modified (only the model line is ignored)", () => {
    const result = catalogStates({
      files: prepared({
        [DEV]: `${withModel(CATALOG[DEV] as string, "opus")}\nMy own rule.\n`,
      }),
    });

    expect(stateOf(result, DEV)).toBe("modified");
  });

  it("given a copy that differs from the catalogue in its description and not in its model, when the states are computed, then it is still modified", () => {
    const text = (CATALOG[DEV] as string).replace(
      /^description:.*$/m,
      "description: mine",
    );

    expect(
      stateOf(catalogStates({ files: prepared({ [DEV]: text }) }), DEV),
    ).toBe("modified");
  });
});

describe("decision 051 L: the health line and the update", () => {
  const repo = (changes: Record<string, string | null> = {}) => ({
    "README.md": "# app\n",
    ...Object.fromEntries(
      Object.entries({ ...CATALOG, ...changes }).filter(([, t]) => t !== null),
    ),
  });
  async function ready(changes: Record<string, string | null> = {}) {
    const ctx = await withProject({
      gitRepos: { [REPO]: { files: repo(changes) } },
    });
    return { ...ctx, git: ctx.fetchMock.git(REPO) };
  }
  const post = (
    ctx: Awaited<ReturnType<typeof ready>>,
    path: string,
    body?: unknown,
  ) =>
    ctx.app.request(`/api/projects/${ctx.projectId}${path}`, {
      method: "POST",
      headers: {
        cookie: ctx.alice.cookie,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const remember = (
    ctx: Awaited<ReturnType<typeof ready>>,
    path: string,
    text: string,
  ) =>
    ctx.db.execute(
      sql`insert into catalog_writes (project_id, path, sha256, written_at) values (${ctx.projectId}, ${path}, ${sha256(text)}, now())`,
    );

  it("given a developer whose model the user changed, when the health is read, then the catalog line lists it as current", async () => {
    const ctx = await withProject({
      files: repo({ [DEV]: withModel(CATALOG[DEV] as string, "opus") }),
    });

    const res = await ctx.app.request(`/api/projects/${ctx.projectId}/health`, {
      headers: { cookie: ctx.alice.cookie },
    });

    const { lines } = (await res.json()) as {
      lines: {
        key: string;
        ok: boolean;
        files?: { path: string; state: string }[];
      }[];
    };
    const line = lines.find((l) => l.key === "catalog");
    expect(line?.ok).toBe(true);
    expect(line?.files?.find((f) => f.path === DEV)?.state).toBe("current");
  });

  it("given an old developer set to opus by the user, when the update is applied, then the file written is the new catalogue text with model: opus, and the reviewer, absent, comes with the model of the catalogue", async () => {
    const old = withModel(pastOf(CATALOG[DEV] as string), "opus");
    const ctx = await ready({ [DEV]: old, [REVIEWER]: null });
    await remember(ctx, DEV, old);

    const res = await post(ctx, "/catalog/apply", {
      files: [
        { path: DEV, before: old },
        { path: REVIEWER, before: null },
      ],
    });

    expect(res.status).toBe(200);
    const sha = ((await res.json()) as { commitSha: string }).commitSha;
    const written = ctx.git.filesAt(sha) ?? {};
    expect(written[DEV]).toBe(withModel(CATALOG[DEV] as string, "opus"));
    expect(written[REVIEWER]).toBe(CATALOG[REVIEWER]);
  });

  it("given an old developer with no model line, when the update is applied, then the new version is written with no model line either", async () => {
    const old = withoutModel(pastOf(CATALOG[DEV] as string));
    const ctx = await ready({ [DEV]: old });
    await remember(ctx, DEV, old);

    const res = await post(ctx, "/catalog/apply", {
      files: [{ path: DEV, before: old }],
    });

    expect(res.status).toBe(200);
    const sha = ((await res.json()) as { commitSha: string }).commitSha;
    expect(ctx.git.filesAt(sha)?.[DEV]).toBe(
      withoutModel(CATALOG[DEV] as string),
    );
  });

  it("given an old skill (no model line in a skill), when the update is applied, then it is written as the catalogue has it", async () => {
    const skill = ".claude/skills/write-us/SKILL.md";
    const old = "the write-us of long ago\n";
    const ctx = await ready({ [skill]: old });
    await remember(ctx, skill, old);

    const res = await post(ctx, "/catalog/apply", {
      files: [{ path: skill, before: old }],
    });

    expect(res.status).toBe(200);
    const sha = ((await res.json()) as { commitSha: string }).commitSha;
    expect(ctx.git.filesAt(sha)?.[skill]).toBe(CATALOG[skill]);
  });

  it("given the update applied to a developer set to opus, when the plan is read again, then it holds no file (the copy is current, not old)", async () => {
    const old = withModel(pastOf(CATALOG[DEV] as string), "opus");
    const ctx = await ready({ [DEV]: old });
    await remember(ctx, DEV, old);
    await post(ctx, "/catalog/apply", { files: [{ path: DEV, before: old }] });

    const res = await post(ctx, "/catalog/plan");

    expect(
      ((await res.json()) as { plan: { files: unknown[] } }).plan.files,
    ).toEqual([]);
  });
});
