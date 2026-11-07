// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import { FILES, text } from "./test-code-map.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  historyText,
  listedTools,
  onlyEntry,
  seedStory,
  seedTicket,
  shape,
  textOf,
} from "./test-mcp.ts";
import {
  cite,
  created,
  criterionRows,
  everything,
  ready,
  rule,
  sourceRows,
  storyOf,
  storyRows,
  takeover,
  ticketRows,
} from "./test-takeover.ts";

// Slice R2 (decision 047 A, B, C, N): the MCP tool `create_takeover_stories`, tested through POST /mcp against the fake GitHub.
//
// Pinned where the decision leaves it open (the developer follows these):
// - Arguments `project_id`, `commit_sha`, `feature`, `stories` (decision 047 A), keys in snake_case; the answer is { ticket_id, stories: [{ id, position }] }.
// - A call that breaks the schema of A (more than 5 criteria, no reasoning, no source...) is refused `Refused: invalid arguments (<path>: <why>)` like every tool, the path
//   being zod's, so it names the faulty field; journaled `invalid_arguments`. The refusals that need the repo or the project say the location with brackets, as
//   `submit_code_map` does: `stories[1].criteria[3].sources[0]` for a citation and `commit_sha` for an unknown commit; journaled `refused` with a closed lowercase code
//   (`project_archived` for an archived project).
// - The history keeps one entry per call, action `create_takeover_stories`, actor claude, origin mcp, with the ids and counts but none of the texts.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decision 047 A, C: a valid call creates the ticket, the stories and the rules", () => {
  it("given two stories of rules that cite real lines, when create_takeover_stories is called, then the ticket « Reprise : <feature> » holds both stories as takeover and to_validate, in order", async () => {
    const ctx = await ready();

    const result = await takeover(
      ctx,
      [storyOf(1), storyOf(2, [rule(2), rule(3)])],
      { feature: "Connexion" },
    );

    const data = dataOf<{
      ticket_id: number;
      stories: { id: number; position: number }[];
    }>(result);
    const tickets = await ticketRows(ctx.db);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      id: data.ticket_id,
      project_id: ctx.projectId,
      title: "Reprise : Connexion",
    });
    const stories = await storyRows(ctx.db);
    expect(
      stories.map((s) => [s.ticket_id, s.position, s.kind, s.status]),
    ).toEqual([
      [data.ticket_id, 1, "takeover", "to_validate"],
      [data.ticket_id, 2, "takeover", "to_validate"],
    ]);
    expect(data.stories).toEqual([
      { id: stories[0]?.id, position: 1 },
      { id: stories[1]?.id, position: 2 },
    ]);
  });

  it("given a rule with a doubt, two sources and object names, when it is created, then the criterion keeps summary, given/when/then, reasoning, doubt, object_names and the state pending, and each source is a row of code_sources with the commit", async () => {
    const ctx = await ready();
    const sources = [cite("api/src/db.ts", 5, 9), cite("web/src/types.ts", 3)];

    await created(ctx, [
      storyOf(1, [
        rule(1, {
          sources,
          doubt: "ce que je n'ai pas pu trancher",
          object_names: ["Order", "Session"],
        }),
        rule(2),
      ]),
    ]);

    const criteria = await criterionRows(ctx.db);
    expect(criteria).toHaveLength(2);
    expect(criteria[0]).toMatchObject({
      position: 1,
      summary: "règle-1",
      given_text: "donné-1",
      when_text: "quand-1",
      then_text: "alors-1",
      reasoning: "raisonnement-1",
      doubt: "ce que je n'ai pas pu trancher",
      object_names: ["Order", "Session"],
      takeover_state: "pending",
    });
    expect(criteria[1]).toMatchObject({
      position: 2,
      summary: "règle-2",
      doubt: null,
      takeover_state: "pending",
    });
    expect(criteria[1]?.object_names ?? []).toEqual([]);
    const rows = await sourceRows(ctx.db);
    expect(
      rows.map((r) => [
        r.criterion_id,
        r.position,
        r.path,
        r.start_line,
        r.end_line,
        r.commit_sha,
      ]),
    ).toEqual([
      [criteria[0]?.id, 0, "api/src/db.ts", 5, 9, ctx.sha],
      [criteria[0]?.id, 1, "web/src/types.ts", 3, 3, ctx.sha],
      [criteria[1]?.id, 0, "api/src/db.ts", 5, 9, ctx.sha],
    ]);
  });

  it("given a story with exactly 5 criteria of 5 sources each, when it is created, then it is accepted", async () => {
    const ctx = await ready();
    const five = Array.from({ length: 5 }, (_, i) =>
      rule(i, {
        sources: Array.from({ length: 5 }, () => cite("api/src/db.ts", 1, 2)),
      }),
    );

    const result = await takeover(ctx, [storyOf(1, five)]);

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(await criterionRows(ctx.db)).toHaveLength(5);
    expect(await sourceRows(ctx.db)).toHaveLength(25);
  });

  it("given the stories have dependencies by position, when it is created, then they are accepted like create_user_stories (depends_on, notes_md)", async () => {
    const ctx = await ready();

    const result = await takeover(ctx, [
      storyOf(1),
      storyOf(2, [rule(2)], { depends_on: [1], notes_md: "des notes" }),
    ]);

    expect(result.isError, textOf(result)).not.toBe(true);
    expect(await storyRows(ctx.db)).toHaveLength(2);
  });

  it("given a call that cites exactly 100 distinct files, when it is sent, then it is accepted", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`api/src/f${i}.ts`, text3()]),
    );
    const ctx = await ready({ ...FILES, ...many });
    const stories = Array.from({ length: 4 }, (_, s) =>
      storyOf(
        s,
        Array.from({ length: 5 }, (_, c) =>
          rule(c, {
            sources: Array.from({ length: 5 }, (_, k) =>
              cite(`api/src/f${s * 25 + c * 5 + k}.ts`, 1, 3),
            ),
          }),
        ),
      ),
    );

    const result = await takeover(ctx, stories);

    expect(result.isError, textOf(result)).not.toBe(true);
  });

  it("given a valid token, when tools/list is read, then create_takeover_stories is listed with an English description and project_id, commit_sha, feature and stories required", async () => {
    const ctx = await ready();

    const tool = (await listedTools(ctx.app, ctx.alice.secret)).find(
      (t) => t.name === "create_takeover_stories",
    );

    expect(tool?.description).toMatch(/[a-z]{4,}/);
    expect(tool?.description).not.toMatch(/[À-ÿ]/);
    expect(tool?.inputSchema?.required).toEqual(
      expect.arrayContaining([
        "project_id",
        "commit_sha",
        "feature",
        "stories",
      ]),
    );
  });

  it("given a valid call, when it is journaled, then there is ONE entry of Claude with the action and no text of the rules", async () => {
    const ctx = await ready();

    await created(ctx, [
      storyOf(1, [rule(1, { doubt: "doute-secret", object_names: ["Order"] })]),
    ]);

    const entry = await onlyEntry(ctx.db);
    expect(shape(entry)).toMatchObject({
      user_id: ctx.alice.id,
      token_id: ctx.alice.tokenId,
      project_id: ctx.projectId,
      actor: "claude",
      origin: "mcp",
      action: "create_takeover_stories",
      result: "ok",
    });
    const journal = await historyText(ctx.db);
    for (const secret of [
      "règle-1",
      "raisonnement-1",
      "donné-1",
      "alors-1",
      "doute-secret",
      "rôle-1",
      "vouloir-1",
      "Facturation",
    ])
      expect(journal).not.toContain(secret);
  });
});

describe("decision 047 A, B: the bounds of the schema", () => {
  const sixCriteria = () => Array.from({ length: 6 }, (_, i) => rule(i));
  const without = (key: string) => ({ ...rule(1), [key]: undefined });
  const cases: [
    string,
    string | RegExp,
    () => unknown[],
    Record<string, unknown>?,
  ][] = [
    [
      "6 criteria in the second story",
      /criteria/,
      () => [storyOf(1), storyOf(2, sixCriteria())],
    ],
    ["no criterion", /criteria/, () => [storyOf(1, [])]],
    [
      "a rule without reasoning",
      /reasoning/,
      () => [storyOf(1, [without("reasoning")])],
    ],
    [
      "a rule with an empty reasoning",
      /reasoning/,
      () => [storyOf(1, [rule(1, { reasoning: "" })])],
    ],
    [
      "a rule without summary",
      /summary/,
      () => [storyOf(1, [without("summary")])],
    ],
    [
      "a summary of 301 characters",
      /summary/,
      () => [storyOf(1, [rule(1, { summary: "x".repeat(301) })])],
    ],
    [
      "a rule with no source",
      /sources/,
      () => [storyOf(1, [rule(1, { sources: [] })])],
    ],
    [
      "6 sources on a rule",
      /sources/,
      () => [
        storyOf(1, [
          rule(1, {
            sources: Array.from({ length: 6 }, () => cite("api/src/db.ts", 1)),
          }),
        ]),
      ],
    ],
    [
      "a source whose start_line is after its end_line",
      /start_line|end_line|sources/,
      () => [storyOf(1, [rule(1, { sources: [cite("api/src/db.ts", 5, 4)] })])],
    ],
    [
      "a source of line 0",
      /start_line|sources/,
      () => [storyOf(1, [rule(1, { sources: [cite("api/src/db.ts", 0, 2)] })])],
    ],
    [
      "a doubt of 1001 characters",
      /doubt/,
      () => [storyOf(1, [rule(1, { doubt: "x".repeat(1001) })])],
    ],
    [
      "21 object names",
      /object_names/,
      () => [
        storyOf(1, [
          rule(1, {
            object_names: Array.from({ length: 21 }, (_, i) => `O${i}`),
          }),
        ]),
      ],
    ],
    [
      "21 stories",
      /stories/,
      () => Array.from({ length: 21 }, (_, i) => storyOf(i)),
    ],
    ["no story", /stories/, () => []],
    [
      "a feature of 201 characters",
      /feature/,
      () => [storyOf(1)],
      { feature: "x".repeat(201) },
    ],
    ["no feature", /feature/, () => [storyOf(1)], { feature: undefined }],
    [
      "a commit_sha of 39 characters",
      /commit_sha/,
      () => [storyOf(1)],
      { commit_sha: "a".repeat(39) },
    ],
  ];

  it.each(cases)(
    "given %s, when create_takeover_stories is called, then Refused naming the faulty field, nothing is created and one invalid_arguments entry is left",
    async (_name, field, build, args) => {
      const ctx = await ready();
      const before = await everything(ctx.db);

      const refused = expectRefused(await takeover(ctx, build(), args));

      expect(refused.startsWith("Refused: invalid arguments (")).toBe(true);
      expect(refused).toMatch(field);
      expect(await everything(ctx.db)).toEqual(before);
      expect((await onlyEntry(ctx.db)).detail).toEqual({
        reason: "invalid_arguments",
      });
    },
  );

  it("given 6 criteria in the second story, when it is refused, then the text says the story is the second one", async () => {
    const ctx = await ready();

    const refused = expectRefused(
      await takeover(ctx, [storyOf(1), storyOf(2, sixCriteria())]),
    );

    expect(refused).toMatch(/stories[.[]1/);
  });
});

describe("decision 047 B: the refusals say where", () => {
  const two = (over: Record<string, unknown>) => [
    storyOf(1, [rule(1)]),
    storyOf(2, [
      rule(2),
      rule(3),
      rule(4, {
        sources: [cite("api/src/db.ts", 1, 2), over],
      }),
    ]),
  ];
  const cases: [string, string, () => unknown[], Record<string, unknown>?][] = [
    [
      "a file absent at that commit",
      "stories[1].criteria[2].sources[1]",
      () => two(cite("api/src/missing.ts")),
    ],
    [
      "a source that is a directory (unreadable as a file)",
      "stories[1].criteria[2].sources[1]",
      () => two(cite("api/src")),
    ],
    [
      "lines past the end of the file (31 on a file of 30)",
      "stories[1].criteria[2].sources[1]",
      () => two(cite("api/src/db.ts", 28, 31)),
    ],
    [
      "a start_line past the end of the file",
      "stories[1].criteria[2].sources[1]",
      () => two(cite("api/src/db.ts", 31, 31)),
    ],
    [
      "a first source that is absent",
      "stories[0].criteria[0].sources[0]",
      () => [storyOf(1, [rule(1, { sources: [cite("nowhere/at/all.ts")] })])],
    ],
    [
      "a commit GitHub does not know",
      "commit_sha",
      () => [storyOf(1)],
      { commit_sha: "f".repeat(40) },
    ],
  ];

  it.each(cases)(
    "given %s, when create_takeover_stories is called, then Refused with the location %s, nothing is created and one refused entry is left",
    async (_name, where, build, args) => {
      const ctx = await ready();
      const before = await everything(ctx.db);

      const refused = expectRefused(await takeover(ctx, build(), args));

      expect(refused).toContain(where);
      expect(await everything(ctx.db)).toEqual(before);
      const entry = await onlyEntry(ctx.db);
      expect(entry).toMatchObject({
        action: "create_takeover_stories",
        result: "refused",
      });
      expect(entry.detail?.reason).toMatch(/^[a-z_]+$/);
    },
  );

  it("given a file that exists in a later commit only, when it is cited at the older commit, then Refused at its source", async () => {
    const ctx = await ready();
    ctx.git.push({ "api/src/new.ts": text(5) });

    const refused = expectRefused(
      await takeover(ctx, [
        storyOf(1, [rule(1, { sources: [cite("api/src/new.ts")] })]),
      ]),
    );

    expect(refused).toContain("stories[0].criteria[0].sources[0]");
  });

  it("given a valid first story and a second one that cites a missing file, when it is sent, then nothing is created at all (all or nothing, ticket included)", async () => {
    const ctx = await ready();

    expectRefused(
      await takeover(ctx, [
        storyOf(1),
        storyOf(2, [rule(2, { sources: [cite("api/src/missing.ts")] })]),
      ]),
    );

    expect(await ticketRows(ctx.db)).toEqual([]);
    expect((await everything(ctx.db)).stories).toEqual([]);
    expect((await everything(ctx.db)).criteria).toEqual([]);
    expect(await sourceRows(ctx.db)).toEqual([]);
  });

  it("given a call that cites 101 distinct files, when it is sent, then Refused saying the limit of 100 files, nothing is created", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`api/src/f${i}.ts`, text3()]),
    );
    const ctx = await ready({ ...FILES, ...many });
    const stories = Array.from({ length: 5 }, (_, s) =>
      storyOf(
        s,
        Array.from({ length: 5 }, (_, c) =>
          rule(c, {
            sources: Array.from({ length: 5 }, (_, k) =>
              cite(`api/src/f${Math.min(s * 25 + c * 5 + k, 100)}.ts`, 1, 3),
            ),
          }),
        ),
      ),
    );

    const refused = expectRefused(await takeover(ctx, stories));

    expect(refused).toMatch(/100/);
    expect(await ticketRows(ctx.db)).toEqual([]);
    expect((await everything(ctx.db)).criteria).toEqual([]);
    expect((await onlyEntry(ctx.db)).detail?.reason).toMatch(/^[a-z_]+$/);
  });

  it("given an archived project, when create_takeover_stories is called, then Refused project_archived and nothing is created", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    expectRefused(await takeover(ctx));

    expect(await ticketRows(ctx.db)).toEqual([]);
    expect((await everything(ctx.db)).stories).toEqual([]);
    expect((await onlyEntry(ctx.db)).detail).toEqual({
      reason: "project_archived",
    });
  });

  it("given a project that is not Alice's, when she calls the tool on it, then Refused as not found and nothing is created", async () => {
    const ctx = await ready();

    const result = await callTool(
      ctx.app,
      ctx.alice.secret,
      "create_takeover_stories",
      {
        project_id: ctx.projectId + 999,
        commit_sha: ctx.sha,
        feature: "x",
        stories: [storyOf(1)],
      },
    );

    expectRefused(result);
    expect(await ticketRows(ctx.db)).toEqual([]);
    expect((await onlyEntry(ctx.db)).detail).toEqual({ reason: "not_found" });
  });
});

describe("decision 047 N: get_user_story shows the rules to /dev-us", () => {
  it("given a takeover story, when get_user_story is called, then the story has kind takeover and each criterion its summary, reasoning, takeover_state and sources", async () => {
    const ctx = await ready();
    const made = await created(ctx, [
      storyOf(1, [
        rule(1, {
          sources: [cite("api/src/db.ts", 5, 9), cite("web/src/types.ts", 3)],
        }),
      ]),
    ]);

    const data = dataOf<{
      story: { kind: string };
      criteria: {
        summary: string;
        reasoning: string;
        takeover_state: string;
        sources: {
          path: string;
          start_line: number;
          end_line: number;
          commit_sha?: string;
        }[];
      }[];
    }>(
      await callTool(ctx.app, ctx.alice.secret, "get_user_story", {
        story_id: made.stories[0]?.id,
      }),
    );

    expect(data.story.kind).toBe("takeover");
    expect(data.criteria).toHaveLength(1);
    expect(data.criteria[0]).toMatchObject({
      summary: "règle-1",
      reasoning: "raisonnement-1",
      takeover_state: "pending",
    });
    expect(
      data.criteria[0]?.sources.map((s) => [s.path, s.start_line, s.end_line]),
    ).toEqual([
      ["api/src/db.ts", 5, 9],
      ["web/src/types.ts", 3, 3],
    ]);
  });

  it("given an ordinary story, when get_user_story is called, then its kind is feature and its criteria carry no rule", async () => {
    const ctx = await ready();
    const ticketId = await seedTicket(ctx.db, ctx.projectId, "Idée");
    const id = await seedStory(ctx.db, ticketId);

    const data = dataOf<{
      story: { kind: string };
      criteria: { takeover_state?: string | null; sources?: unknown[] }[];
    }>(
      await callTool(ctx.app, ctx.alice.secret, "get_user_story", {
        story_id: id,
      }),
    );

    expect(data.story.kind).toBe("feature");
    expect(data.criteria[0]?.takeover_state ?? null).toBeNull();
    expect(data.criteria[0]?.sources ?? []).toEqual([]);
  });
});

// A file of 3 lines.
function text3() {
  return text(3);
}
