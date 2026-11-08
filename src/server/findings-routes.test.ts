// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentsReads } from "./test-code-map.ts";
import { send } from "./test-decisions.ts";
import {
  type Ctx,
  cite,
  finding,
  findingRows,
  findingSourceRows,
  ready,
  setStatus,
  submitted,
} from "./test-findings.ts";
import { githubCalls } from "./test-github.ts";
import {
  archiveProject,
  type Row,
  rows,
  seedProject,
  userWithToken,
} from "./test-mcp.ts";
import {
  criterionIds,
  rule,
  sourceRows,
  storyOf,
  takeover,
  ticketRows,
  withRules,
} from "./test-takeover.ts";

// Slice R5 (decision 051 D, E, F, G, H, I): the human routes on the findings, through app.request() on PGlite against the fake GitHub.
//
// Pinned shapes (the decision leaves them open; the web tests of src/web/Findings.test.tsx use the same):
// - GET  /api/projects/:id/findings[?status=open|ticketed|dismissed|later] -> 200 { findings: [Finding] }, every status when there is no filter, sorted by severity
//   (critical, high, medium, low), then the most recent first (created_at, then id, descending). A Finding is
//   { id, kind, source, title, bodyMd, severity, effort: string | null, status, ticketId: number | null, dismissReason: string | null, commitSha, createdAt,
//     sources: [{ path, startLine, endLine, commitSha }] (in the order of the finding), unprotected: boolean }.
//   `unprotected` (the reminder of choice L, computed on every read, never stored) is true only for an `architecture` or `stack` finding none of whose cited files is cited
//   by a frozen rule (a rule of a done story whose criterion passed, decision 050 F) of the project; it is false for every other kind. Reading is allowed on an archived project.
// - POST /api/findings/:id/ticket   no body                 -> 200 { ticket: { id, title } }: a ticket of the project titled as the finding, whose description_md holds the body and one
//                                                              GitHub permalink per source (`https://github.com/<owner>/<repo>/blob/<commit>/<path>#L<start>-L<end>`, `#L<n>` for one line);
//                                                              the finding becomes `ticketed` with that ticket_id
// - POST /api/findings/:id/dismiss  { reason?: string }     -> 200 { finding }: status dismissed, dismiss_reason the reason (null without)
// - POST /api/findings/:id/later    no body                 -> 200 { finding }: status later (still to decide)
// - Refusals: 400 { error: "Bad request" } for a body that is not valid, 401 without a session, 404 { error: "Not found" } for a non-member and an unknown finding,
//   409 { error: "project_archived" }, and 409 { error: "not_open" } for a finding that is already ticketed or dismissed (a `later` or `open` one can be decided).
//   A 409 leaves one `refused` entry (detail { reason: <the same code> }); a 400, a 401 and a 404 leave none.
// - The history: actor human, origin ui, actions ticket_finding, dismiss_finding, later_finding, with project_id (and ticket_id for the ticket).
// - « C'est un bug » (POST /api/criteria/:id/bug, decision 047 E) also stores a `bug` finding (source claude, severity medium, status ticketed, ticket_id of the bug ticket) whose
//   title contains the summary of the rule, body_md its summary and its reasoning, and whose sources are copies of the sources of the rule (the rule is deleted, its own rows go).
// - GET /api/projects/:id/code also serves a (sha, path) cited by a source of a finding of that project.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Listed = {
  id: number;
  kind: string;
  source: string;
  title: string;
  bodyMd: string;
  severity: string;
  effort: string | null;
  status: string;
  ticketId: number | null;
  dismissReason: string | null;
  commitSha: string;
  createdAt: string;
  sources: {
    path: string;
    startLine: number;
    endLine: number;
    commitSha: string;
  }[];
  unprotected: boolean;
};
type Reader = Pick<Ctx, "app" | "alice" | "projectId">;
const read = (ctx: Reader, query = "", cookie = ctx.alice.cookie) =>
  send(
    ctx.app,
    cookie,
    "GET",
    `/api/projects/${ctx.projectId}/findings${query}`,
  );
const listed = async (ctx: Reader, query = "") => {
  const res = await read(ctx, query);
  expect(res.status).toBe(200);
  return ((await res.json()) as { findings: Listed[] }).findings;
};
const decide = (
  ctx: Pick<Ctx, "app" | "alice">,
  verb: "ticket" | "dismiss" | "later",
  id: number | string,
  body?: unknown,
  cookie = ctx.alice.cookie,
) => send(ctx.app, cookie, "POST", `/api/findings/${id}/${verb}`, body);
const entries = (db: Ctx["db"], action: string) =>
  rows(db, sql`action = ${action}`) as Promise<Row[]>;
const count = async (db: Ctx["db"]) =>
  (
    (await db.execute(
      sql`select count(*)::int as n from history where action not in ('create_token', 'sync_issue')`,
    )) as unknown as { rows: { n: number }[] }
  ).rows[0]?.n;

/** Alice's project with three findings: a critical security one (two sources), a medium bug, a low architecture one. */
async function withThree() {
  const ctx = await ready();
  const { findings } = await submitted(ctx, [
    finding(1, {
      kind: "security",
      severity: "critical",
      effort: "small",
      sources: [cite("api/src/db.ts", 5, 9), cite("web/src/types.ts", 3)],
    }),
    finding(2),
    finding(3, { kind: "architecture", severity: "low" }),
  ]);
  return { ...ctx, ids: findings.map((f) => f.id) };
}

describe("decision 051 D: GET /api/projects/:id/findings", () => {
  it("given three findings, when a member reads them, then each comes with its fields, its sources in order and its commit", async () => {
    const ctx = await withThree();

    const found = await listed(ctx);

    expect(found.map((f) => f.id).sort()).toEqual([...ctx.ids].sort());
    const first = found.find((f) => f.id === ctx.ids[0]);
    expect(first).toMatchObject({
      kind: "security",
      source: "claude",
      title: "constat-1",
      bodyMd: "texte-1\n\n- étape 1",
      severity: "critical",
      effort: "small",
      status: "open",
      ticketId: null,
      dismissReason: null,
      commitSha: ctx.sha,
      sources: [
        { path: "api/src/db.ts", startLine: 5, endLine: 9, commitSha: ctx.sha },
        {
          path: "web/src/types.ts",
          startLine: 3,
          endLine: 3,
          commitSha: ctx.sha,
        },
      ],
    });
    expect(
      Math.abs(Date.parse(first?.createdAt as string) - Date.now()),
    ).toBeLessThan(60_000);
    expect(found.find((f) => f.id === ctx.ids[1])?.effort).toBeNull();
  });

  it("given findings of every gravity, when they are read, then they come by severity, then the most recent first", async () => {
    const ctx = await ready();
    const { findings } = await submitted(ctx, [
      finding(1, { severity: "low" }),
      finding(2, { severity: "high" }),
      finding(3, { severity: "high" }),
      finding(4, { severity: "critical" }),
      finding(5, { severity: "medium" }),
    ]);
    const [low, olderHigh, newerHigh, critical, medium] = findings.map(
      (f) => f.id,
    );
    // The most recent of the lot is the low one; the critical one is the oldest.
    const at = [
      [low, "2026-11-07T12:00:00Z"],
      [olderHigh, "2026-11-05T12:00:00Z"],
      [newerHigh, "2026-11-06T12:00:00Z"],
      [critical, "2026-11-01T12:00:00Z"],
      [medium, "2026-11-04T12:00:00Z"],
    ] as const;
    for (const [id, when] of at)
      await ctx.db.execute(
        sql`update findings set created_at = ${when}::timestamptz where id = ${id as number}`,
      );

    const found = await listed(ctx);

    expect(found.map((f) => f.id)).toEqual([
      critical,
      newerHigh,
      olderHigh,
      medium,
      low,
    ]);
  });

  it("given findings in every status, when they are read with a status, then only those, and without a filter all of them", async () => {
    const ctx = await withThree();
    await setStatus(ctx.db, ctx.ids[1] as number, "dismissed", {
      reason: "faux positif",
    });
    await setStatus(ctx.db, ctx.ids[2] as number, "later");

    expect((await listed(ctx)).map((f) => f.status).sort()).toEqual([
      "dismissed",
      "later",
      "open",
    ]);
    expect((await listed(ctx, "?status=open")).map((f) => f.id)).toEqual([
      ctx.ids[0],
    ]);
    const dismissed = await listed(ctx, "?status=dismissed");
    expect(dismissed.map((f) => [f.id, f.dismissReason])).toEqual([
      [ctx.ids[1], "faux positif"],
    ]);
    expect((await listed(ctx, "?status=later")).map((f) => f.id)).toEqual([
      ctx.ids[2],
    ]);
    expect((await read(ctx, "?status=nonsense")).status).toBe(400);
  });

  it("given no finding, when a member reads them, then 200 with an empty list", async () => {
    const ctx = await ready();

    expect(await listed(ctx)).toEqual([]);
  });

  it("given an archived project, when a member reads its findings, then they are served", async () => {
    const ctx = await withThree();
    await archiveProject(ctx.db, ctx.projectId);

    expect(await listed(ctx)).toHaveLength(3);
  });

  it("given the findings of Alice's project, when another project of Alice reads its findings, then it does not see them", async () => {
    const ctx = await withThree();
    const other = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });

    expect(await listed({ ...ctx, projectId: other })).toEqual([]);
  });

  it("given a non-member, no session or an unknown project, when the findings are read, then 404, 401 and 404", async () => {
    const ctx = await withThree();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    expect((await read(ctx)).status, "the route exists").toBe(200);
    expect((await read(ctx, "", bob.cookie)).status).toBe(404);
    expect((await read(ctx, "", "")).status).toBe(401);
    expect((await read({ ...ctx, projectId: 99_999 })).status).toBe(404);
  });
});

describe("decision 051 I: the reminder of choice L is computed on every read", () => {
  const freeze = async (
    ctx: Awaited<ReturnType<typeof withRules>>,
    index: number,
  ) => {
    await ctx.db.execute(
      sql`update user_stories set status = 'done' where id = ${ctx.stories[index]?.id}`,
    );
    await ctx.db.execute(
      sql`update acceptance_criteria set result = 'passed', evidence = 'preuve' where id = ${ctx.ids[index]}`,
    );
  };
  const advice = async (
    ctx: Awaited<ReturnType<typeof withRules>>,
    kinds: string[],
    path = "api/src/db.ts",
  ) => {
    const made = await submitted(
      ctx,
      kinds.map((kind, i) => finding(i, { kind, sources: [cite(path, 1, 2)] })),
    );
    const found = await listed(ctx);
    return made.findings.map(
      (m) => found.find((f) => f.id === m.id)?.unprotected,
    );
  };

  it("given rules none of which is frozen, when an architecture and a stack finding are read, then both are unprotected, and a bug and a security finding are not", async () => {
    const ctx = await withRules();

    expect(
      await advice(ctx, ["architecture", "stack", "bug", "security"]),
    ).toEqual([true, true, false, false]);
  });

  it("given a file cited by a frozen rule, when an architecture finding that cites it is read, then it is protected", async () => {
    const ctx = await withRules();
    await freeze(ctx, 0);

    expect(await advice(ctx, ["architecture", "stack"])).toEqual([
      false,
      false,
    ]);
  });

  it("given a finding that cites a file the frozen rule does not cite, when it is read, then it is unprotected (files are compared, not lines)", async () => {
    const ctx = await withRules();
    await freeze(ctx, 0);

    expect(await advice(ctx, ["architecture"], "web/src/types.ts")).toEqual([
      true,
    ]);
  });

  it("given a rule that cites the file but is only kept (its story is not done), when an architecture finding is read, then it is unprotected", async () => {
    const ctx = await withRules();
    await ctx.db.execute(
      sql`update acceptance_criteria set takeover_state = 'kept' where id = ${ctx.ids[0]}`,
    );

    expect(await advice(ctx, ["architecture"])).toEqual([true]);
  });

  it("given a frozen rule, when it stops being frozen, then the next read says unprotected again (nothing is stored)", async () => {
    const ctx = await withRules();
    await freeze(ctx, 0);
    expect(await advice(ctx, ["architecture"])).toEqual([false]);

    await ctx.db.execute(
      sql`update acceptance_criteria set result = 'failed' where id = ${ctx.ids[0]}`,
    );

    const [only] = await listed(ctx);
    expect(only?.unprotected).toBe(true);
  });
});

describe("decision 051 G: « En faire un ticket »", () => {
  it("given an open finding of two sources, when a member makes a ticket of it, then a ticket is created in the project with the title, the body and the permalinks, and the finding is ticketed with it", async () => {
    const ctx = await withThree();

    const res = await decide(ctx, "ticket", ctx.ids[0] as number);

    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as {
      ticket: { id: number; title: string };
    };
    expect(ticket.title).toBe("constat-1");
    const made = (await ticketRows(ctx.db)).find((t) => t.id === ticket.id);
    expect(made).toMatchObject({
      project_id: ctx.projectId,
      title: "constat-1",
    });
    expect(made?.description_md).toContain("texte-1");
    expect(made?.description_md).toContain(
      `https://github.com/user1000/app/blob/${ctx.sha}/api/src/db.ts#L5-L9`,
    );
    expect(made?.description_md).toContain(
      `https://github.com/user1000/app/blob/${ctx.sha}/web/src/types.ts#L3`,
    );
    expect(made?.description_md).not.toContain("types.ts#L3-L3");
    const [first, second, third] = await findingRows(ctx.db);
    expect(first).toMatchObject({ status: "ticketed", ticket_id: ticket.id });
    expect(second).toMatchObject({ status: "open", ticket_id: null });
    expect(third).toMatchObject({ status: "open", ticket_id: null });
  });

  it("given the ticket made, when the history is read, then one ticket_finding entry of the human, from the UI, holds the project and the ticket", async () => {
    const ctx = await withThree();

    const { ticket } = (await (
      await decide(ctx, "ticket", ctx.ids[0] as number)
    ).json()) as { ticket: { id: number } };

    const [entry] = await entries(ctx.db, "ticket_finding");
    expect(await entries(ctx.db, "ticket_finding")).toHaveLength(1);
    expect(entry).toMatchObject({
      user_id: ctx.alice.id,
      project_id: ctx.projectId,
      ticket_id: ticket.id,
      actor: "human",
      origin: "ui",
      result: "ok",
    });
  });

  it("given a finding put off with « Plus tard », when a member makes a ticket of it, then it works", async () => {
    const ctx = await withThree();
    expect((await decide(ctx, "later", ctx.ids[0] as number)).status).toBe(200);

    const res = await decide(ctx, "ticket", ctx.ids[0] as number);

    expect(res.status).toBe(200);
    expect((await findingRows(ctx.db))[0]?.status).toBe("ticketed");
  });

  it("given a finding already ticketed, when a ticket is asked again, then 409 not_open, no second ticket and one refused entry", async () => {
    const ctx = await withThree();
    expect((await decide(ctx, "ticket", ctx.ids[0] as number)).status).toBe(
      200,
    );
    const tickets = (await ticketRows(ctx.db)).length;

    const res = await decide(ctx, "ticket", ctx.ids[0] as number);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_open" });
    expect(await ticketRows(ctx.db)).toHaveLength(tickets);
    const refused = await rows(ctx.db, sql`result = 'refused'`);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.detail).toEqual({ reason: "not_open" });
  });
});

describe("decision 051 G: « Rejeter » and « Plus tard »", () => {
  it("given an open finding, when a member dismisses it with a reason, then it is dismissed with the reason, no ticket is made and one dismiss_finding entry is left", async () => {
    const ctx = await withThree();
    const tickets = (await ticketRows(ctx.db)).length;

    const res = await decide(ctx, "dismiss", ctx.ids[1] as number, {
      reason: "le cas ne se présente jamais",
    });

    expect(res.status).toBe(200);
    expect((await findingRows(ctx.db))[1]).toMatchObject({
      status: "dismissed",
      dismiss_reason: "le cas ne se présente jamais",
      ticket_id: null,
    });
    expect(await ticketRows(ctx.db)).toHaveLength(tickets);
    const [entry] = await entries(ctx.db, "dismiss_finding");
    expect(await entries(ctx.db, "dismiss_finding")).toHaveLength(1);
    expect(entry).toMatchObject({
      actor: "human",
      origin: "ui",
      project_id: ctx.projectId,
    });
  });

  it("given an open finding, when a member dismisses it with no reason (no body, or an empty one), then it is dismissed and the reason is null", async () => {
    const ctx = await withThree();

    expect((await decide(ctx, "dismiss", ctx.ids[1] as number)).status).toBe(
      200,
    );
    expect(
      (await decide(ctx, "dismiss", ctx.ids[2] as number, {})).status,
    ).toBe(200);

    const rowsNow = await findingRows(ctx.db);
    expect(rowsNow.map((r) => [r.status, r.dismiss_reason])).toEqual([
      ["open", null],
      ["dismissed", null],
      ["dismissed", null],
    ]);
  });

  it("given a reason that is not a string, when a finding is dismissed, then 400, nothing changes and no entry is left", async () => {
    const ctx = await withThree();

    const res = await decide(ctx, "dismiss", ctx.ids[1] as number, {
      reason: 5,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
    expect((await findingRows(ctx.db))[1]?.status).toBe("open");
    expect(await entries(ctx.db, "dismiss_finding")).toEqual([]);
  });

  it("given a dismissed finding, when it is read with the filter dismissed, then it is found with its reason; and it can no longer be ticketed or dismissed again", async () => {
    const ctx = await withThree();
    await decide(ctx, "dismiss", ctx.ids[1] as number, { reason: "raison" });

    const found = await listed(ctx, "?status=dismissed");
    const again = await decide(ctx, "dismiss", ctx.ids[1] as number);
    const ticket = await decide(ctx, "ticket", ctx.ids[1] as number);

    expect(found.map((f) => [f.id, f.dismissReason])).toEqual([
      [ctx.ids[1], "raison"],
    ]);
    expect(again.status).toBe(409);
    expect(ticket.status).toBe(409);
  });

  it("given an open finding, when a member says « Plus tard », then it is later, still to decide, with one later_finding entry", async () => {
    const ctx = await withThree();

    const res = await decide(ctx, "later", ctx.ids[1] as number);

    expect(res.status).toBe(200);
    expect((await findingRows(ctx.db))[1]).toMatchObject({
      status: "later",
      ticket_id: null,
    });
    expect(await entries(ctx.db, "later_finding")).toHaveLength(1);
  });

  it("given a later finding, when a member dismisses it, then it is dismissed", async () => {
    const ctx = await withThree();
    await decide(ctx, "later", ctx.ids[1] as number);

    expect((await decide(ctx, "dismiss", ctx.ids[1] as number)).status).toBe(
      200,
    );

    expect((await findingRows(ctx.db))[1]?.status).toBe("dismissed");
  });
});

describe("decision 051 G: who may triage", () => {
  const verbs = ["ticket", "dismiss", "later"] as const;

  it.each(verbs)(
    "given a non-member, when he calls %s, then 404, nothing changes and no entry is left",
    async (verb) => {
      const ctx = await withThree();
      const bob = await userWithToken(ctx.app, ctx.db, 2000);
      const before = await findingRows(ctx.db);
      const tickets = await ticketRows(ctx.db);
      const entriesBefore = await count(ctx.db);

      const res = await decide(
        ctx,
        verb,
        ctx.ids[0] as number,
        undefined,
        bob.cookie,
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
      expect(await findingRows(ctx.db)).toEqual(before);
      expect(await ticketRows(ctx.db)).toEqual(tickets);
      expect(await count(ctx.db)).toBe(entriesBefore);
    },
  );

  it.each(verbs)(
    "given no session, when %s is called, then 401",
    async (verb) => {
      const ctx = await withThree();

      expect(
        (await decide(ctx, verb, ctx.ids[0] as number, undefined, "")).status,
      ).toBe(401);
    },
  );

  it.each(verbs)(
    "given an unknown finding, when %s is called, then 404",
    async (verb) => {
      const ctx = await withThree();

      const res = await decide(ctx, verb, 999_999);

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not found" });
    },
  );

  it.each(verbs)(
    "given an archived project, when %s is called, then 409 project_archived, nothing changes and one refused entry is left",
    async (verb) => {
      const ctx = await withThree();
      await archiveProject(ctx.db, ctx.projectId);
      const before = await findingRows(ctx.db);
      const tickets = await ticketRows(ctx.db);

      const res = await decide(ctx, verb, ctx.ids[0] as number);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "project_archived" });
      expect(await findingRows(ctx.db)).toEqual(before);
      expect(await ticketRows(ctx.db)).toEqual(tickets);
      const refused = await rows(ctx.db, sql`result = 'refused'`);
      expect(refused).toHaveLength(1);
      expect(refused[0]?.detail).toEqual({ reason: "project_archived" });
    },
  );
});

describe("decision 051 H: « C'est un bug » also stores a bug finding", () => {
  const bug = (ctx: Awaited<ReturnType<typeof withRules>>, index: number) =>
    send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/criteria/${ctx.ids[index]}/bug`,
    );

  it("given a rule with two sources and a reasoning, when a member says it is a bug, then a bug finding is stored with the rule, its reasoning, copies of its sources, severity medium, ticketed and linked to the bug ticket", async () => {
    const ctx = await withRules();

    const res = await bug(ctx, 0);

    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as { ticket: { id: number } };
    const found = await findingRows(ctx.db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      project_id: ctx.projectId,
      kind: "bug",
      source: "claude",
      severity: "medium",
      status: "ticketed",
      ticket_id: ticket.id,
      commit_sha: ctx.sha,
    });
    expect(found[0]?.title).toContain("règle-1");
    expect(found[0]?.body_md).toContain("règle-1");
    expect(found[0]?.body_md).toContain("raisonnement-1");
    expect(
      (await findingSourceRows(ctx.db)).map((s) => [
        s.finding_id,
        s.position,
        s.path,
        s.start_line,
        s.end_line,
        s.commit_sha,
      ]),
    ).toEqual([
      [found[0]?.id, 0, "api/src/db.ts", 5, 9, ctx.sha],
      [found[0]?.id, 1, "api/src/db.ts", 18, 24, ctx.sha],
    ]);
  });

  it("given the rule deleted by the bug, when the finding is read, then it is there with its sources, ticketed and linked", async () => {
    const ctx = await withRules();
    const { ticket } = (await (await bug(ctx, 0)).json()) as {
      ticket: { id: number };
    };

    const [only] = await listed(ctx);

    expect(only).toMatchObject({
      kind: "bug",
      status: "ticketed",
      ticketId: ticket.id,
      severity: "medium",
    });
    expect(only?.sources).toHaveLength(2);
  });

  it("given two rules said to be bugs, when it is done twice, then two findings exist, each with its own ticket", async () => {
    const ctx = await withRules();
    await bug(ctx, 0);
    await bug(ctx, 1);

    const found = await findingRows(ctx.db);

    expect(found).toHaveLength(2);
    expect(new Set(found.map((f) => f.ticket_id)).size).toBe(2);
  });

  it("given a refused « C'est un bug » (an archived project), when it is called, then no finding is stored", async () => {
    const ctx = await withRules();
    await archiveProject(ctx.db, ctx.projectId);

    expect((await bug(ctx, 0)).status).toBe(409);

    expect(await findingRows(ctx.db)).toEqual([]);
  });

  it("given a rule with two sources said to be a bug, when the sources are counted, then the two of the rule went with it and only the finding keeps its copies", async () => {
    const ctx = await withRules();
    const before = (await sourceRows(ctx.db)).length;

    await bug(ctx, 0);

    expect(await findingSourceRows(ctx.db)).toHaveLength(2);
    // Two sources went with the rule, the two copies belong to the finding.
    expect(
      (await sourceRows(ctx.db)).filter((s) => s.criterion_id != null).length,
    ).toBe(before - 2);
  });
});

describe("decision 051 F: GET /api/projects/:id/code serves the code a finding cites", () => {
  const code = (
    ctx: Reader,
    query: Record<string, string>,
    projectId: number = ctx.projectId,
  ) =>
    ctx.app.request(
      `/api/projects/${projectId}/code?${new URLSearchParams(query)}`,
      { headers: { cookie: ctx.alice.cookie } },
    );

  it("given a finding that cites lines of a file no map and no rule holds, when that file at that commit is asked, then 200 with the lines read on GitHub", async () => {
    const ctx = await ready();
    await submitted(ctx, [
      finding(1, { sources: [cite("api/src/db.ts", 10, 12)] }),
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

  it("given a file cited by no finding, no rule and no map, when it is asked, then 404 and GitHub is not read", async () => {
    const ctx = await ready();
    await submitted(ctx, [finding(1)]);
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

  it("given a finding of another project of Alice, when this project asks for its file, then 404", async () => {
    const ctx = await ready();
    await submitted(ctx, [finding(1)]);
    const other = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });

    const res = await code(
      ctx,
      { sha: ctx.sha, path: "api/src/db.ts", start: "5", end: "9" },
      other,
    );

    expect(res.status).toBe(404);
  });

  it("given a finding that cites a file at one commit, when it is asked at another commit, then 404", async () => {
    const ctx = await ready();
    await submitted(ctx, [finding(1)]);
    const later = ctx.git.push({ "api/src/db.ts": "changed\n".repeat(30) });

    const res = await code(ctx, {
      sha: later,
      path: "api/src/db.ts",
      start: "5",
      end: "9",
    });

    expect(res.status).toBe(404);
  });

  it("given a rule that cites one file and a finding that cites another, when each is asked, then both are served", async () => {
    const ctx = await ready();
    await takeover(ctx, [
      storyOf(1, [rule(1, { sources: [cite("web/src/types.ts", 3, 5)] })]),
    ]);
    await submitted(ctx, [
      finding(1, { sources: [cite("api/src/db.ts", 1, 2)] }),
    ]);

    const rule1 = await code(ctx, {
      sha: ctx.sha,
      path: "web/src/types.ts",
      start: "3",
      end: "5",
    });
    const finding1 = await code(ctx, {
      sha: ctx.sha,
      path: "api/src/db.ts",
      start: "1",
      end: "2",
    });

    expect(rule1.status).toBe(200);
    expect(finding1.status).toBe(200);
    expect((await criterionIds(ctx.db)).length).toBeGreaterThan(0);
  });
});
