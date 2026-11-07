// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiModule, contentsReads, submit } from "./test-code-map.ts";
import { entryCount, send, validate } from "./test-decisions.ts";
import { githubCalls } from "./test-github.ts";
import {
  archiveProject,
  dataOf,
  type Row,
  rows,
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
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
  ticketRows,
  withRules,
} from "./test-takeover.ts";

// Slice R2 (decision 047 D, E, H, K and the read of the screen): the human routes on the rules, through app.request() on PGlite against the fake GitHub.
//
// Pinned shapes (the decision leaves them open; the web tests of src/web/Reprise.test.tsx use the same):
// - POST  /api/criteria/:id/keep      no body                                -> 200 { rule }   (state "kept")
// - POST  /api/criteria/:id/unkeep    no body                                -> 200 { rule }   (state "pending")
// - PATCH /api/criteria/:id           { summary, given, when, then }         -> 200 { rule }   (the state stays as it is: pending)
// - POST  /api/criteria/:id/bug       no body                                -> 200 { ticket: { id, title } }
// - GET   /api/projects/:id/rules                                            -> 200 { rules: [rule] }, in the order of the ticket, of the story, of the criterion, of the stories
//   `to_validate` of kind takeover only. A rule is
//   { id, storyId, ticketId, position, summary, reasoning, doubt: string | null, given, when, then, state: "pending" | "kept",
//     objects: [{ name, inMap: boolean }], sources: [{ path, startLine, endLine, commitSha }] }   (sources and objects in the order of the rule)
//   `inMap` is true when an object of that name is in the stored map of any module of the project.
// - Refusals: 400 { error: "Bad request" }, 401 without a session, 404 { error: "Not found" } for a non-member and an unknown criterion,
//   409 { error: "not_takeover" | "project_archived" }. A refusal that found its criterion leaves one `refused` entry (detail { reason: <the same code> });
//   a 400, a 401 or a 404 leaves none.
// - The history: actor human, origin ui, actions keep_rule, unkeep_rule, edit_rule, bug_rule, with project_id, ticket_id and story_id.
// - The bug ticket is « Bug : <summary> » in the same project; its description_md holds the rule's summary, its reasoning and one GitHub permalink per source,
//   `https://github.com/<owner>/<repo>/blob/<commit>/<path>#L<start>-L<end>` (`#L<n>` for one line).
// - Validating a takeover story with a pending rule: 409 { error: "rules_pending", pending: [{ id, summary }] }, a `refused` entry `rules_pending`.
// - GET /api/projects/:id/code serves a (sha, path) cited by a source of a rule of the project, and still 404 for one cited nowhere.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Rule = {
  id: number;
  storyId: number;
  ticketId: number;
  position: number;
  summary: string;
  reasoning: string;
  doubt: string | null;
  given: string;
  when: string;
  then: string;
  state: string;
  objects: { name: string; inMap: boolean }[];
  sources: {
    path: string;
    startLine: number;
    endLine: number;
    commitSha: string;
  }[];
};
type Ctx = Awaited<ReturnType<typeof withRules>>;

const act = (
  ctx: Pick<Ctx, "app" | "alice">,
  verb: "keep" | "unkeep" | "bug" | "edit",
  id: number | string,
  body?: unknown,
  cookie = ctx.alice.cookie,
) =>
  verb === "edit"
    ? send(ctx.app, cookie, "PATCH", `/api/criteria/${id}`, body)
    : send(ctx.app, cookie, "POST", `/api/criteria/${id}/${verb}`);
const rulesOf = async (ctx: Pick<Ctx, "app" | "alice" | "projectId">) => {
  const res = await send(
    ctx.app,
    ctx.alice.cookie,
    "GET",
    `/api/projects/${ctx.projectId}/rules`,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { rules: Rule[] }).rules;
};
const stateOf = async (ctx: Ctx, id: number) =>
  (await criterionRows(ctx.db)).find((r) => r.id === id)?.takeover_state;
const EDIT = {
  summary: "règle corrigée",
  given: "donné corrigé",
  when: "quand corrigé",
  then: "alors corrigé",
};

describe("decision 047 E: « Valider la règle » (keep) and its undo", () => {
  it("given a pending rule, when a member keeps it, then 200 with the rule kept, the state is kept in the table and one keep_rule entry of the human is left", async () => {
    const ctx = await withRules();
    const [first] = ctx.ids;

    const res = await act(ctx, "keep", first as number);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { rule: Rule }).rule).toMatchObject({
      id: first,
      state: "kept",
    });
    expect(await stateOf(ctx, first as number)).toBe("kept");
    expect(await stateOf(ctx, ctx.ids[1] as number)).toBe("pending");
    const entries = await rows(ctx.db, sql`action = 'keep_rule'`);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: ctx.alice.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      project_id: ctx.projectId,
      ticket_id: ctx.ticketId,
      story_id: ctx.stories[0]?.id,
    });
  });

  it("given a kept rule, when the member undoes the keep, then it is pending again and one unkeep_rule entry is left", async () => {
    const ctx = await withRules();
    const first = ctx.ids[0] as number;
    expect((await act(ctx, "keep", first)).status).toBe(200);

    const res = await act(ctx, "unkeep", first);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { rule: Rule }).rule.state).toBe("pending");
    expect(await stateOf(ctx, first)).toBe("pending");
    expect(await rows(ctx.db, sql`action = 'unkeep_rule'`)).toHaveLength(1);
  });
});

describe("decision 047 E: « Corriger le texte »", () => {
  it("given a pending rule, when a member corrects the text, then summary and given/when/then change and the sources, reasoning, doubt, object_names and the state stay", async () => {
    const ctx = await withRules();
    const first = ctx.ids[0] as number;
    const before = (await criterionRows(ctx.db)).find((r) => r.id === first);
    const sourcesBefore = await sourceRows(ctx.db);

    const res = await act(ctx, "edit", first, EDIT);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { rule: Rule }).rule).toMatchObject({
      id: first,
      ...EDIT,
      state: "pending",
    });
    const after = (await criterionRows(ctx.db)).find((r) => r.id === first);
    expect(after).toMatchObject({
      summary: EDIT.summary,
      given_text: EDIT.given,
      when_text: EDIT.when,
      then_text: EDIT.then,
      reasoning: before?.reasoning,
      doubt: before?.doubt,
      object_names: before?.object_names,
      takeover_state: "pending",
      position: before?.position,
      story_id: before?.story_id,
    });
    expect(await sourceRows(ctx.db)).toEqual(sourcesBefore);
    expect(await rows(ctx.db, sql`action = 'edit_rule'`)).toHaveLength(1);
  });

  it.each([
    ["an empty summary", { ...EDIT, summary: "  " }],
    ["a summary of 301 characters", { ...EDIT, summary: "x".repeat(301) }],
    ["no given", { ...EDIT, given: undefined }],
    ["no when", { ...EDIT, when: "" }],
    ["no then", { ...EDIT, then: undefined }],
  ])(
    "given %s, when a member corrects the text, then 400, nothing changes and no entry is left",
    async (_name, body) => {
      const ctx = await withRules();
      const before = await criterionRows(ctx.db);
      const entries = await entryCount(ctx.db);

      const res = await act(ctx, "edit", ctx.ids[0] as number, body);

      expect(res.status).toBe(400);
      expect(await criterionRows(ctx.db)).toEqual(before);
      expect(await entryCount(ctx.db)).toBe(entries);
    },
  );
});

describe("decision 047 E: « C'est un bug »", () => {
  it("given a rule with two sources, when a member says it is a bug, then a ticket « Bug : <summary> » is created in the project with the rule, the reasoning and the GitHub permalinks of the sources", async () => {
    const ctx = await withRules();
    const first = ctx.ids[0] as number;
    const ticketsBefore = (await ticketRows(ctx.db)).length;

    const res = await act(ctx, "bug", first);

    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as {
      ticket: { id: number; title: string };
    };
    expect(ticket.title).toBe("Bug : règle-1");
    const tickets = await ticketRows(ctx.db);
    expect(tickets).toHaveLength(ticketsBefore + 1);
    const bug = tickets.find((t) => t.id === ticket.id);
    expect(bug).toMatchObject({
      project_id: ctx.projectId,
      title: "Bug : règle-1",
    });
    expect(bug?.description_md).toContain("règle-1");
    expect(bug?.description_md).toContain("raisonnement-1");
    expect(bug?.description_md).toContain(
      `https://github.com/user1000/app/blob/${ctx.sha}/api/src/db.ts#L5-L9`,
    );
    expect(bug?.description_md).toContain(
      `https://github.com/user1000/app/blob/${ctx.sha}/api/src/db.ts#L18-L24`,
    );
    expect(await rows(ctx.db, sql`action = 'bug_rule'`)).toHaveLength(1);
  });

  it("given a rule with one cited line, when it is a bug, then the permalink is #L<n>", async () => {
    const ctx = await ready();
    const made = await created(ctx, [
      storyOf(1, [rule(1, { sources: [cite("api/src/db.ts", 7)] })]),
    ]);
    const id = (await criterionRows(ctx.db))[0]?.id as number;

    const res = await act(ctx, "bug", id);

    expect(res.status).toBe(200);
    const bug = (await ticketRows(ctx.db)).find(
      (t) => t.title === "Bug : règle-1",
    );
    expect(bug?.description_md).toContain(`blob/${ctx.sha}/api/src/db.ts#L7`);
    expect(made.stories).toHaveLength(1);
  });

  it("given a story with two rules, when one is a bug, then the criterion and its sources are gone, the other rule and the story stay, and the story is not abandoned", async () => {
    const ctx = await withRules();
    const [first, second] = ctx.ids as [number, number];

    expect((await act(ctx, "bug", first)).status).toBe(200);

    const criteria = await criterionRows(ctx.db);
    expect(criteria.map((c) => c.id)).not.toContain(first);
    expect(criteria.map((c) => c.id)).toContain(second);
    expect((await sourceRows(ctx.db)).map((s) => s.criterion_id)).not.toContain(
      first,
    );
    const story = (await storyRows(ctx.db)).find(
      (s) => s.id === ctx.stories[0]?.id,
    );
    expect(story?.status).toBe("to_validate");
  });

  it("given a story whose last rule is a bug, when the member says so, then the story is abandoned (and the other stories are not)", async () => {
    const ctx = await withRules();
    const [first, second, third] = ctx.ids as [number, number, number];
    expect((await act(ctx, "bug", first)).status).toBe(200);

    expect((await act(ctx, "bug", second)).status).toBe(200);

    const stories = await storyRows(ctx.db);
    expect(stories.find((s) => s.id === ctx.stories[0]?.id)?.status).toBe(
      "abandoned",
    );
    expect(stories.find((s) => s.id === ctx.stories[1]?.id)?.status).toBe(
      "to_validate",
    );
    expect((await criterionRows(ctx.db)).map((c) => c.id)).toEqual([third]);
    // Gone from the screen too.
    expect((await rulesOf(ctx)).map((r) => r.id)).toEqual([third]);
  });
});

describe("decision 047 E: who may decide", () => {
  const verbs = [
    ["keep", undefined],
    ["unkeep", undefined],
    ["edit", EDIT],
    ["bug", undefined],
  ] as const;

  it.each(verbs)(
    "given a non-member, when he calls %s on a rule, then 404, nothing changes and no entry is left",
    async (verb, body) => {
      const ctx = await withRules();
      const bob = await userWithToken(ctx.app, ctx.db, 2000);
      const before = await everything(ctx.db);
      const entries = await entryCount(ctx.db);

      const res = await act(ctx, verb, ctx.ids[0] as number, body, bob.cookie);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
      expect(await everything(ctx.db)).toEqual(before);
      expect(await entryCount(ctx.db)).toBe(entries);
    },
  );

  it.each(verbs)(
    "given no session, when %s is called, then 401",
    async (verb, body) => {
      const ctx = await withRules();

      const res = await act(ctx, verb, ctx.ids[0] as number, body, "");

      expect(res.status).toBe(401);
    },
  );

  it.each(verbs)(
    "given an unknown criterion, when %s is called, then 404",
    async (verb, body) => {
      const ctx = await withRules();

      const res = await act(ctx, verb, 999_999, body);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    },
  );

  it.each(verbs)(
    "given a criterion of an ordinary story, when %s is called, then 409 not_takeover, nothing changes and one refused entry is left",
    async (verb, body) => {
      const ctx = await withRules();
      const ticketId = await seedTicket(ctx.db, ctx.projectId, "Idée");
      await seedStory(ctx.db, ticketId, { status: "to_validate" });
      const ordinary = (await criterionRows(ctx.db)).find(
        (c) => c.takeover_state === null,
      );
      expect(ordinary, "a criterion of a feature story").toBeDefined();
      const before = await everything(ctx.db);

      const res = await act(ctx, verb, ordinary?.id as number, body);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_takeover" });
      expect(await everything(ctx.db)).toEqual(before);
      const refused = (await rows(ctx.db, sql`result = 'refused'`)) as Row[];
      expect(refused).toHaveLength(1);
      expect(refused[0]?.detail).toEqual({ reason: "not_takeover" });
    },
  );

  it.each(verbs)(
    "given an archived project, when %s is called, then 409 project_archived, nothing changes and one refused entry is left",
    async (verb, body) => {
      const ctx = await withRules();
      await archiveProject(ctx.db, ctx.projectId);
      const before = await everything(ctx.db);
      const sources = await sourceRows(ctx.db);

      const res = await act(ctx, verb, ctx.ids[0] as number, body);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "project_archived" });
      expect(await everything(ctx.db)).toEqual(before);
      expect(await sourceRows(ctx.db)).toEqual(sources);
      const refused = await rows(ctx.db, sql`result = 'refused'`);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.detail).toEqual({ reason: "project_archived" });
    },
  );
});

describe("decision 047 I, J: GET /api/projects/:id/rules, the rules of the screen", () => {
  it("given two takeover stories, when a member reads the rules, then they come in the order of the story and the criterion with their texts, state, sources and objects", async () => {
    const ctx = await withRules();

    const list = await rulesOf(ctx);

    expect(list.map((r) => r.summary)).toEqual([
      "règle-1",
      "règle-2",
      "règle-3",
    ]);
    expect(list[0]).toMatchObject({
      id: ctx.ids[0],
      storyId: ctx.stories[0]?.id,
      ticketId: ctx.ticketId,
      position: 1,
      reasoning: "raisonnement-1",
      doubt: "doute-1",
      given: "donné-1",
      when: "quand-1",
      then: "alors-1",
      state: "pending",
    });
    expect(list[1]?.doubt).toBeNull();
    expect(list[0]?.sources).toEqual([
      { path: "api/src/db.ts", startLine: 5, endLine: 9, commitSha: ctx.sha },
      { path: "api/src/db.ts", startLine: 18, endLine: 24, commitSha: ctx.sha },
    ]);
    expect(list[2]?.sources).toEqual([
      {
        path: "web/src/types.ts",
        startLine: 3,
        endLine: 5,
        commitSha: ctx.sha,
      },
    ]);
  });

  it("given rules that cite one object of the map and one that is absent from it, when they are read, then each object says whether it is in the map", async () => {
    const ctx = await withRules();

    const list = await rulesOf(ctx);

    expect(list[0]?.objects).toEqual([
      { name: "Order", inMap: true },
      { name: "Ghost", inMap: false },
    ]);
    expect(list[1]?.objects).toEqual([{ name: "User", inMap: true }]);
    expect(list[2]?.objects).toEqual([]);
  });

  it("given two features taken over, when the rules are read, then the first ticket comes first, and a kept rule says kept", async () => {
    const ctx = await ready();
    await created(ctx, [storyOf(1, [rule(1), rule(2)])], { feature: "A" });
    await created(ctx, [storyOf(2, [rule(3)])], { feature: "B" });
    const first = (await criterionRows(ctx.db))[0]?.id as number;
    expect((await act(ctx, "keep", first)).status).toBe(200);

    const list = await rulesOf(ctx);

    expect(list.map((r) => [r.summary, r.state])).toEqual([
      ["règle-1", "kept"],
      ["règle-2", "pending"],
      ["règle-3", "pending"],
    ]);
  });

  it("given a takeover story that is no longer to_validate and an ordinary story, when the rules are read, then neither is listed", async () => {
    const ctx = await withRules();
    await ctx.db.execute(
      sql`update user_stories set status = 'ready' where id = ${ctx.stories[1]?.id}`,
    );
    const ticketId = await seedTicket(ctx.db, ctx.projectId, "Idée");
    await seedStory(ctx.db, ticketId, { status: "to_validate" });

    const list = await rulesOf(ctx);

    expect(list.map((r) => r.summary)).toEqual(["règle-1", "règle-2"]);
  });

  it("given no rule, when a member reads them, then 200 with no rule", async () => {
    const ctx = await ready();

    expect(await rulesOf(ctx)).toEqual([]);
  });

  it("given a non-member or no session, when the rules are read, then 404 and 401", async () => {
    const ctx = await withRules();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const path = `/api/projects/${ctx.projectId}/rules`;

    const res = await send(ctx.app, bob.cookie, "GET", path);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect((await ctx.app.request(path)).status).toBe(401);
  });

  it("given the rules of Alice's project, when another project of Alice reads its rules, then it does not see them", async () => {
    const ctx = await withRules();
    const other = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "GET",
      `/api/projects/${other}/rules`,
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { rules: Rule[] }).rules).toEqual([]);
  });
});

describe("decision 047 H: GET /api/projects/:id/code serves the code a rule cites", () => {
  const code = (
    ctx: Pick<Ctx, "app" | "alice" | "projectId">,
    query: Record<string, string>,
  ) =>
    ctx.app.request(
      `/api/projects/${ctx.projectId}/code?${new URLSearchParams(query)}`,
      { headers: { cookie: ctx.alice.cookie } },
    );

  it("given a rule that cites lines of a file the map does not hold, when that file at that commit is asked, then 200 with the lines read on GitHub", async () => {
    const ctx = await ready();
    await created(ctx, [
      storyOf(1, [rule(1, { sources: [cite("api/src/db.ts", 10, 12)] })]),
    ]);

    const res = await code(ctx, {
      sha: ctx.sha,
      path: "api/src/db.ts",
      start: "10",
      end: "12",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { firstLine: number; lines: string[] };
    expect(body.firstLine).toBe(7);
    expect(body.lines).toEqual(
      Array.from({ length: 9 }, (_, i) => `db ${7 + i}`),
    );
  });

  it("given a file cited by no rule and no map, when it is asked, then 404 and GitHub is not read", async () => {
    const ctx = await ready();
    await created(ctx, [storyOf(1)]);
    // Creating the rule already read its own cited file to verify it.
    const before = githubCalls(ctx.fetchMock).length;

    const res = await code(ctx, {
      sha: ctx.sha,
      path: "web/src/types.ts",
      start: "1",
      end: "2",
    });

    expect(res.status).toBe(404);
    expect(contentsReads(githubCalls(ctx.fetchMock).slice(before))).toEqual([]);
  });

  it("given a file cited by a rule at one commit, when it is asked at another commit, then 404", async () => {
    const ctx = await ready();
    await created(ctx, [storyOf(1)]);
    const later = ctx.git.push({ "api/src/db.ts": "changed\n".repeat(30) });

    const res = await code(ctx, {
      sha: later,
      path: "api/src/db.ts",
      start: "5",
      end: "9",
    });

    expect(res.status).toBe(404);
  });

  it("given a rule of another project of Alice, when this project asks for its file, then 404", async () => {
    const ctx = await ready();
    await created(ctx, [storyOf(1)]);
    const other = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });

    const res = await ctx.app.request(
      `/api/projects/${other}/code?${new URLSearchParams({ sha: ctx.sha, path: "api/src/db.ts", start: "5", end: "9" })}`,
      { headers: { cookie: ctx.alice.cookie } },
    );

    expect(res.status).toBe(404);
  });

  it("given a map that cites a file and a rule that cites another, when each is asked, then both are served", async () => {
    const ctx = await ready();
    dataOf(await submit(ctx, [apiModule()]));
    await created(ctx, [
      storyOf(1, [rule(1, { sources: [cite("web/src/types.ts", 3, 5)] })]),
    ]);

    const inMap = await code(ctx, {
      sha: ctx.sha,
      path: "api/src/db.ts",
      start: "1",
      end: "2",
    });
    const inRule = await code(ctx, {
      sha: ctx.sha,
      path: "web/src/types.ts",
      start: "3",
      end: "5",
    });

    expect(inMap.status).toBe(200);
    expect(inRule.status).toBe(200);
  });
});

describe("decision 047 K: validating a takeover story", () => {
  it("given a takeover story with two pending rules, when a member validates it, then 409 rules_pending naming both, the story stays to_validate and one refused entry rules_pending is left", async () => {
    const ctx = await withRules();
    const story = ctx.stories[0]?.id as number;

    const res = await validate(ctx.app, ctx.alice.cookie, story);

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      pending: { id: number; summary: string }[];
    };
    expect(body.error).toBe("rules_pending");
    expect(body.pending.map((p) => [p.id, p.summary])).toEqual([
      [ctx.ids[0], "règle-1"],
      [ctx.ids[1], "règle-2"],
    ]);
    expect((await storyRows(ctx.db)).find((s) => s.id === story)?.status).toBe(
      "to_validate",
    );
    const refused = await rows(
      ctx.db,
      sql`action = 'validate_story' and result = 'refused'`,
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.detail).toEqual({ reason: "rules_pending" });
  });

  it("given one of two rules kept, when the story is validated, then the refusal names only the pending one", async () => {
    const ctx = await withRules();
    expect((await act(ctx, "keep", ctx.ids[0] as number)).status).toBe(200);

    const res = await validate(
      ctx.app,
      ctx.alice.cookie,
      ctx.stories[0]?.id as number,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { pending: { id: number }[] };
    expect(body.pending.map((p) => p.id)).toEqual([ctx.ids[1]]);
  });

  it("given all the rules of the story kept, when it is validated, then 200 and the story is ready", async () => {
    const ctx = await withRules();
    expect((await act(ctx, "keep", ctx.ids[0] as number)).status).toBe(200);
    expect((await act(ctx, "keep", ctx.ids[1] as number)).status).toBe(200);

    const res = await validate(
      ctx.app,
      ctx.alice.cookie,
      ctx.stories[0]?.id as number,
    );

    expect(res.status).toBe(200);
    expect(
      (await storyRows(ctx.db)).find((s) => s.id === ctx.stories[0]?.id)
        ?.status,
    ).toBe("ready");
  });

  it("given a rule kept then undone, when the story is validated, then it is refused again", async () => {
    const ctx = await withRules();
    const [first, second] = ctx.ids as [number, number];
    for (const id of [first, second]) await act(ctx, "keep", id);
    await act(ctx, "unkeep", second);

    const res = await validate(
      ctx.app,
      ctx.alice.cookie,
      ctx.stories[0]?.id as number,
    );

    expect(res.status).toBe(409);
  });

  it("given an ordinary story, when it is validated, then nothing changes: 200 and ready", async () => {
    const ctx = await withRules();
    const ticketId = await seedTicket(ctx.db, ctx.projectId, "Idée");
    const id = await seedStory(ctx.db, ticketId, { status: "to_validate" });

    const res = await validate(ctx.app, ctx.alice.cookie, id);

    expect(res.status).toBe(200);
    expect((await storyRows(ctx.db)).find((s) => s.id === id)?.status).toBe(
      "ready",
    );
  });

  it("given a takeover story whose rule was a bug and the others kept, when it is validated, then it is accepted (a bug is no pending rule)", async () => {
    const ctx = await withRules();
    const [first, second] = ctx.ids as [number, number];
    expect((await act(ctx, "bug", first)).status).toBe(200);
    expect((await act(ctx, "keep", second)).status).toBe(200);

    const res = await validate(
      ctx.app,
      ctx.alice.cookie,
      ctx.stories[0]?.id as number,
    );

    expect(res.status).toBe(200);
  });
});

describe("decision 047 K: GET /api/stories/:id shows the rules to the story page", () => {
  it("given a takeover story, when it is read, then its kind is takeover and each criterion gives its summary and takeoverState, and an ordinary story is feature", async () => {
    const ctx = await withRules();
    expect((await act(ctx, "keep", ctx.ids[1] as number)).status).toBe(200);

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "GET",
      `/api/stories/${ctx.stories[0]?.id}`,
    );

    const { story } = (await res.json()) as {
      story: {
        kind: string;
        criteria: { id: number; summary: string; takeoverState: string }[];
      };
    };
    expect(story.kind).toBe("takeover");
    expect(
      story.criteria.map((c) => [c.id, c.summary, c.takeoverState]),
    ).toEqual([
      [ctx.ids[0], "règle-1", "pending"],
      [ctx.ids[1], "règle-2", "kept"],
    ]);
    const ticketId = await seedTicket(ctx.db, ctx.projectId, "Idée");
    const id = await seedStory(ctx.db, ticketId);
    const plain = (await (
      await send(ctx.app, ctx.alice.cookie, "GET", `/api/stories/${id}`)
    ).json()) as { story: { kind: string } };
    expect(plain.story.kind).toBe("feature");
  });
});
