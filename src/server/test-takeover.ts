// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import {
  apiModule,
  type Ctx,
  cite,
  readyPro as ready,
  submit,
  webModule,
} from "./test-code-map.ts";
import { callTool, dataOf, type TestDb } from "./test-mcp.ts";

// Shared by the tests of slice R2 (decision 047): the arguments of `create_takeover_stories`, and the tables of the rules read with raw SQL
// (so no test depends on the Drizzle export of a column).
//
// Pinned names (decision 047 C and D give the columns; the rest is the choice of these tests, the developer follows them):
// - user_stories.kind ('feature' | 'takeover'); acceptance_criteria.summary, reasoning, doubt, object_names (a list of names), takeover_state ('pending' | 'kept' | null);
//   code_sources(criterion_id, position, path, start_line, end_line, commit_sha); tickets.title, description_md, project_id.
// - create_takeover_stories answers { ticket_id, stories: [{ id, position }] }.

export { type Ctx, cite, ready };

export const rule = (n: number, over: Record<string, unknown> = {}) => ({
  summary: `règle-${n}`,
  given: `donné-${n}`,
  when: `quand-${n}`,
  then: `alors-${n}`,
  reasoning: `raisonnement-${n}`,
  sources: [cite("api/src/db.ts", 5, 9)],
  ...over,
});

export const storyOf = (
  n: number,
  criteria: unknown[] = [rule(n)],
  over: Record<string, unknown> = {},
) => ({
  as_a: `rôle-${n}`,
  i_want: `vouloir-${n}`,
  so_that: `but-${n}`,
  criteria,
  ...over,
});

/** A `create_takeover_stories` call on the project of `ctx`; `args` overrides any argument. */
export const takeover = (
  ctx: Pick<Ctx, "app" | "alice" | "projectId" | "sha">,
  stories: unknown[] = [storyOf(1)],
  args: Record<string, unknown> = {},
) =>
  callTool(ctx.app, ctx.alice.secret, "create_takeover_stories", {
    project_id: ctx.projectId,
    commit_sha: ctx.sha,
    feature: "Facturation",
    stories,
    ...args,
  });

export type Created = {
  ticket_id: number;
  stories: { id: number; position: number }[];
};
export const created = async (
  ctx: Parameters<typeof takeover>[0],
  stories?: unknown[],
  args?: Record<string, unknown>,
) => dataOf<Created>(await takeover(ctx, stories, args));

/** A project whose repo has a map (api and web) and one takeover story of two rules, and one of one rule, under the ticket « Reprise : Facturation ». */
export async function withRules() {
  const ctx = await ready();
  dataOf(await submit(ctx, [apiModule(), webModule()]));
  const made = await created(ctx, [
    storyOf(1, [
      rule(1, {
        sources: [cite("api/src/db.ts", 5, 9), cite("api/src/db.ts", 18, 24)],
        object_names: ["Order", "Ghost"],
        doubt: "doute-1",
      }),
      rule(2, { object_names: ["User"] }),
    ]),
    storyOf(2, [rule(3, { sources: [cite("web/src/types.ts", 3, 5)] })]),
  ]);
  const ids = await criterionIds(ctx.db);
  return { ...ctx, ...made, ids, ticketId: made.ticket_id };
}

const all = async <T>(db: TestDb, query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;

export type CriterionRow = {
  id: number;
  story_id: number;
  position: number;
  summary: string | null;
  given_text: string;
  when_text: string;
  then_text: string;
  reasoning: string | null;
  doubt: string | null;
  object_names: string[] | null;
  takeover_state: string | null;
};
export const criterionRows = (db: TestDb) =>
  all<CriterionRow>(
    db,
    sql`select id, story_id, position, summary, given_text, when_text, then_text, reasoning, doubt, object_names, takeover_state
        from acceptance_criteria order by id`,
  );
export const criterionIds = async (db: TestDb) =>
  (await criterionRows(db)).map((r) => r.id);

export type SourceRow = {
  criterion_id: number;
  position: number;
  path: string;
  start_line: number;
  end_line: number;
  commit_sha: string;
};
export const sourceRows = (db: TestDb) =>
  all<SourceRow>(
    db,
    sql`select criterion_id, position, path, start_line, end_line, commit_sha from code_sources order by criterion_id, position`,
  );

export type StoryRow = {
  id: number;
  ticket_id: number;
  position: number;
  kind: string;
  status: string;
};
export const storyRows = (db: TestDb) =>
  all<StoryRow>(
    db,
    sql`select id, ticket_id, position, kind, status from user_stories order by id`,
  );

export type TicketRow = {
  id: number;
  project_id: number;
  title: string;
  description_md: string;
};
export const ticketRows = (db: TestDb) =>
  all<TicketRow>(
    db,
    sql`select id, project_id, title, description_md from tickets order by id`,
  );

/** What a refused call must leave as it was, read from columns that exist before the slice (so a refusal test fails on the tool, not on a missing column). */
export async function everything(db: TestDb) {
  return {
    tickets: await all(
      db,
      sql`select id, project_id, title from tickets order by id`,
    ),
    stories: await all(
      db,
      sql`select id, ticket_id, position, status from user_stories order by id`,
    ),
    criteria: await all(
      db,
      sql`select id, story_id, position from acceptance_criteria order by id`,
    ),
  };
}
