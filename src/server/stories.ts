import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notLike,
  or,
  sql,
} from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  history,
  STORY_STATUSES,
  storyDependencies,
  tickets,
  userStories,
} from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import { parseIssue } from "./issue-render.ts";
import { issueOf, shouldHaveIssue, syncIssue } from "./issues.ts";
import { followPullRequest } from "./pr-follow.ts";
import { isDatabaseId, memberProject } from "./projects.ts";
import type { Fire } from "./routines.ts";
import { storyRuns } from "./runs.ts";
import {
  assertActive,
  body,
  criterionText,
  descriptionMd,
  narrative,
  noNul,
  refusal,
} from "./tickets.ts";

export type StoryStatus = typeof userStories.$inferSelect.status;

/** What `list_tickets_needing_us` lists (decision 017), also what the scheduled writing looks at (decision 022 E): tickets whose writing is open, and stories sent back, of tickets not abandoned. */
export const ticketNeedsStories = and(
  isNull(tickets.abandonedAt),
  isNull(tickets.storiesWrittenAt),
);
export const storyToRewrite = and(
  isNull(tickets.abandonedAt),
  eq(userStories.status, "to_rewrite"),
);

/** The statuses of the stories of many tickets in one query, for `ticketStep` (no query per ticket). A ticket without story has no entry. Shortcut: one parameter per id, so PostgreSQL's 65,535 limit; upgrade with a subquery on the project if a project ever holds that many tickets. */
export async function storyStatuses(db: Db, ticketIds: number[]) {
  const byTicket = new Map<number, StoryStatus[]>();
  if (ticketIds.length === 0) return byTicket;
  const found = await db
    .select({ ticketId: userStories.ticketId, status: userStories.status })
    .from(userStories)
    .where(inArray(userStories.ticketId, ticketIds));
  for (const { ticketId, status } of found)
    byTicket.set(ticketId, [...(byTicket.get(ticketId) ?? []), status]);
  return byTicket;
}

/** The stories of one ticket, in order. */
export const ticketStories = (db: Db, ticketId: number) =>
  db
    .select({
      id: userStories.id,
      position: userStories.position,
      iWant: userStories.iWant,
      status: userStories.status,
    })
    .from(userStories)
    .where(eq(userStories.ticketId, ticketId))
    .orderBy(asc(userStories.position), asc(userStories.id));

/** A story the user may reach, with its ticket and project: the access goes through the project of the ticket; undefined for anyone else, as if it did not exist (decisions 004 and 017). */
export async function memberStory(db: Db, userId: number, id: number) {
  if (!isDatabaseId(id)) return undefined;
  const [found] = await db
    .select({ story: userStories, ticket: tickets })
    .from(userStories)
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .where(eq(userStories.id, id));
  const project =
    found && (await memberProject(db, userId, found.ticket.projectId));
  return project && { ...found, project };
}

/** The criteria of a story in order, and the stories it depends on (with their issue number, for the issue's « Dépend de #12 »). */
export async function storyParts(db: Db, storyId: number) {
  const criteria = await db
    .select()
    .from(acceptanceCriteria)
    .where(eq(acceptanceCriteria.storyId, storyId))
    .orderBy(asc(acceptanceCriteria.position));
  const dependsOn = await db
    .select({
      id: userStories.id,
      status: userStories.status,
      iWant: userStories.iWant,
      issueNumber: userStories.issueNumber,
    })
    .from(storyDependencies)
    .innerJoin(userStories, eq(userStories.id, storyDependencies.dependsOnId))
    .where(eq(storyDependencies.storyId, storyId))
    .orderBy(asc(userStories.position), asc(userStories.id));
  return { criteria, dependsOn };
}

type Found = NonNullable<Awaited<ReturnType<typeof memberStory>>>;
type Story = typeof userStories.$inferSelect;

/** The story is not in a status the action starts from; carries the status for Claude's refusal text (the history only gets the code). */
export class WrongStatus extends Refused {
  status: StoryStatus;
  constructor(status: StoryStatus) {
    super("wrong_status");
    this.status = status;
  }
}

/** A takeover story with rules still to decide cannot be validated (decision 047 K); carries them for the answer (the history only gets the code). */
export class RulesPending extends Refused {
  pending: { id: number; summary: string }[];
  constructor(pending: { id: number; summary: string }[]) {
    super("rules_pending");
    this.pending = pending;
  }
}

/** One decision on a story, in one `act` (decision 018 F): the project is checked, then the story is re-read FOR UPDATE and only then its status, so the status checked is the one changed. `entry` gets the ids; `change` returns the story as written. */
export function changeStory(
  db: Db,
  entry: Entry,
  { story, ticket, project }: Found,
  from: StoryStatus[],
  change: (tx: Tx, locked: Story) => Promise<Story>,
  // keep-cockpit may settle a divergence on a story whose ticket was abandoned afterwards: the story is not edited, only its stored GitHub text goes.
  { allowAbandonedTicket = false } = {},
) {
  entry.projectId = project.id;
  entry.ticketId = ticket.id;
  entry.storyId = story.id;
  entry.args = { storyId: story.id };
  return act(db, entry, async (tx) => {
    await assertActive(tx, project.id);
    const [locked] = await tx
      .select()
      .from(userStories)
      .where(eq(userStories.id, story.id))
      .for("update");
    if (!locked) throw new Refused("not_found");
    // Read, not locked: abandon_ticket locks the ticket then its stories, so locking the ticket after a story could deadlock; an abandoned ticket has its stories abandoned in the same transaction anyway.
    const [parent] = await tx
      .select({ abandonedAt: tickets.abandonedAt })
      .from(tickets)
      .where(eq(tickets.id, locked.ticketId));
    if (parent?.abandonedAt && !allowAbandonedTicket)
      throw new Refused("ticket_abandoned");
    if (!from.includes(locked.status)) throw new WrongStatus(locked.status);
    return change(tx, locked);
  });
}

/** Writes fields of a locked story, and returns it as written. */
async function updateStory(
  tx: Tx,
  id: number,
  set: Partial<Pick<Story, "status" | "rewriteComment">>,
) {
  const [row] = await tx
    .update(userStories)
    .set({ ...set, updatedAt: sql`now()` })
    .where(eq(userStories.id, id))
    .returning();
  if (!row) throw new Refused("not_found");
  return row;
}

/** Replaces the narrative, the notes and the whole list of criteria of a locked story (decisions 018 C and E). Omitted notes are kept, an empty string empties them; the criteria are replaced, not merged. */
export async function rewriteStory(
  tx: Tx,
  id: number,
  fields: {
    asA: string;
    iWant: string;
    soThat: string;
    notesMd?: string;
    criteria: { given: string; when: string; then: string }[];
  },
  set: Partial<Pick<Story, "status" | "rewriteComment">> = {},
) {
  // The criteria are replaced: the sources and the state of a rule would go with them (decision 047).
  const [rule] = await tx
    .select({ id: acceptanceCriteria.id })
    .from(acceptanceCriteria)
    .where(
      and(
        eq(acceptanceCriteria.storyId, id),
        isNotNull(acceptanceCriteria.takeoverState),
      ),
    )
    .limit(1);
  if (rule) throw new Refused("takeover_story");
  await tx.delete(acceptanceCriteria).where(eq(acceptanceCriteria.storyId, id));
  await tx.insert(acceptanceCriteria).values(
    fields.criteria.map((k, index) => ({
      storyId: id,
      position: index + 1,
      givenText: k.given,
      whenText: k.when,
      thenText: k.then,
    })),
  );
  await tx
    .update(userStories)
    .set({
      asA: fields.asA,
      iWant: fields.iWant,
      soThat: fields.soThat,
      notesMd: fields.notesMd, // undefined: drizzle leaves the column alone
    })
    .where(eq(userStories.id, id));
  return updateStory(tx, id, set);
}

/** Ends the divergence of a locked story (decision 025 F and G). The stored hash goes too, so the sync that follows writes even when the render did not change: GitHub holds someone else's text. */
async function settleDivergence(tx: Tx, id: number) {
  const [row] = await tx
    .update(userStories)
    .set({
      issueGithubTitle: null,
      issueGithubBody: null,
      issueDivergedAt: null,
      issueBodyHash: null,
    })
    .where(eq(userStories.id, id))
    .returning();
  if (!row) throw new Refused("not_found");
  return row;
}

const diverged = (story: Story) => {
  if (!story.issueDivergedAt) throw new Refused("no_divergence");
  return story.issueGithubBody ?? "";
};

type Parts = Awaited<ReturnType<typeof storyParts>>;

const presentStory = (story: Story, parts: Parts, fullName: string) => ({
  id: story.id,
  ticketId: story.ticketId,
  position: story.position,
  asA: story.asA,
  iWant: story.iWant,
  soThat: story.soThat,
  notesMd: story.notesMd,
  kind: story.kind,
  status: story.status,
  branch: story.branch,
  prNumber: story.prNumber,
  prCiState: story.prCiState,
  prReviewState: story.prReviewState,
  rewriteComment: story.rewriteComment,
  criteria: parts.criteria.map((k) => ({
    id: k.id,
    position: k.position,
    given: k.givenText,
    when: k.whenText,
    // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the API (decision 017)
    then: k.thenText,
    summary: k.summary,
    takeoverState: k.takeoverState,
    result: k.result,
    evidence: k.evidence,
    resultRunId: k.resultRunId,
  })),
  dependsOn: parts.dependsOn.map(({ id, status, iWant }) => ({
    id,
    status,
    iWant,
  })),
  issue: issueOf(story, parts, fullName),
});

/** Behind the gate of `projectRoutes` (503 before the session check), which also covers /api/stories/*. */
export function storyRoutes(db: Db, readGitHub: ReadGitHub, fire: Fire) {
  /** The story as it is now (after the sync of its issue), for the answer of a decision. */
  const reread = async (id: number, fullName: string) => {
    const [story] = await db
      .select()
      .from(userStories)
      .where(eq(userStories.id, id));
    if (!story) throw new Refused("not_found");
    return presentStory(story, await storyParts(db, id), fullName);
  };
  /** A human decision: the caller's story, its allowed statuses, the change; then the sync of its issue (decision 020 F, which never fails the decision); answers with the story. */
  const decide = async (
    c: Context,
    action: string,
    from: StoryStatus[],
    change: (tx: Tx, locked: Story) => Promise<Story>,
    options?: { allowAbandonedTicket: boolean },
  ) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const found = await memberStory(db, user.userId, Number(c.req.param("id")));
    if (!found) return c.json({ error: "Not found" }, 404);
    const entry: Entry = {
      userId: user.userId,
      actor: "human",
      origin: "ui",
      action,
      args: {},
    };
    try {
      const story = await changeStory(db, entry, found, from, change, options);
      await syncIssue(db, readGitHub, user.userId, story.id);
      return c.json({ story: await reread(story.id, found.project.fullName) });
    } catch (error) {
      if (error instanceof RulesPending)
        return c.json({ error: error.message, pending: error.pending }, 409);
      return refusal(c, error);
    }
  };
  const sendBackBody = z.object({
    comment: z.string().trim().min(1).max(2_000).refine(noNul),
  });
  // The status is no field: an extra key is dropped, never applied (decision 018 G).
  const editBody = z.object({
    asA: narrative,
    iWant: narrative,
    soThat: narrative,
    notesMd: descriptionMd.optional(),
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

  return new Hono()
    .get("/api/stories/:id", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const found = await memberStory(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json({ error: "Not found" }, 404);
      const { story, ticket, project } = found;
      return c.json({
        story: {
          ...presentStory(
            story,
            await storyParts(db, story.id),
            project.fullName,
          ),
          runs: await storyRuns(db, story.id),
        },
        ticket: { id: ticket.id, title: ticket.title },
        project: {
          id: project.id,
          fullName: project.fullName,
          defaultBranch: project.defaultBranch,
          archived: project.archivedAt !== null,
        },
      });
    })
    .get("/api/stories/:id/history", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const found = await memberStory(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json({ error: "Not found" }, 404);
      // One query (no N+1): the story's own entries, minus the reads (only get_user_story carries a story id), and the writes of its ticket that concern all its stories (decisions 018 I and 017).
      const entries = await db
        .select({
          id: history.id,
          at: history.at,
          action: history.action,
          result: history.result,
          actor: history.actor,
        })
        .from(history)
        .where(
          and(
            eq(history.userId, user.userId),
            or(
              and(
                eq(history.storyId, found.story.id),
                notLike(history.action, "get\\_%"),
              ),
              and(
                eq(history.ticketId, found.ticket.id),
                inArray(history.action, [
                  "create_user_stories",
                  "abandon_ticket",
                ]),
                eq(history.result, "ok"),
              ),
            ),
          ),
        )
        .orderBy(desc(history.at), desc(history.id))
        .limit(100);
      return c.json({ entries });
    })
    .post("/api/stories/:id/publish", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const found = await memberStory(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json({ error: "Not found" }, 404);
      if (found.project.archivedAt)
        return c.json({ error: "project_archived" }, 409);
      if (!shouldHaveIssue(found.story))
        return c.json({ error: "wrong_status" }, 409);
      await syncIssue(db, readGitHub, user.userId, found.story.id);
      return c.json({
        story: await reread(found.story.id, found.project.fullName),
      });
    })
    .post("/api/stories/:id/pr/refresh", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const found = await memberStory(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!found) return c.json({ error: "Not found" }, 404);
      if (found.story.prNumber === null)
        return c.json({ error: "no_pull_request" }, 409);
      try {
        await followPullRequest(db, readGitHub, found, user.userId, "ui", fire);
      } catch (error) {
        console.error(`Refresh of the PR of story ${found.story.id}:`, error);
        return c.json({ error: "github_unavailable" }, 502);
      }
      return c.json({
        story: await reread(found.story.id, found.project.fullName),
      });
    })
    .post("/api/stories/:id/validate", (c) =>
      decide(
        c,
        "validate_story",
        ["to_validate", "to_rewrite"],
        async (tx, story) => {
          const pending = await tx
            .select({
              id: acceptanceCriteria.id,
              summary: acceptanceCriteria.summary,
            })
            .from(acceptanceCriteria)
            .where(
              and(
                eq(acceptanceCriteria.storyId, story.id),
                eq(acceptanceCriteria.takeoverState, "pending"),
              ),
            )
            .orderBy(asc(acceptanceCriteria.position));
          if (pending.length > 0)
            throw new RulesPending(
              pending.map((p) => ({ id: p.id, summary: p.summary ?? "" })),
            );
          return updateStory(tx, story.id, {
            status: "ready",
            rewriteComment: null,
          });
        },
      ),
    )
    .post("/api/stories/:id/send-back", body(sendBackBody), (c) =>
      decide(c, "send_back_story", ["to_validate"], async (tx, story) => {
        // Claude cannot rewrite a takeover story (rewriteStory refuses it): sent back, it would be stuck.
        if (story.kind === "takeover") throw new Refused("takeover_story");
        return updateStory(tx, story.id, {
          status: "to_rewrite",
          rewriteComment: c.req.valid("json").comment,
        });
      }),
    )
    .patch("/api/stories/:id", body(editBody), (c) =>
      decide(
        c,
        "update_story",
        ["to_validate", "to_rewrite", "ready"],
        (tx, story) => rewriteStory(tx, story.id, c.req.valid("json")),
      ),
    )
    .post("/api/stories/:id/issue/keep-cockpit", (c) =>
      decide(
        c,
        "keep_cockpit_issue",
        [...STORY_STATUSES],
        (tx, story) => {
          diverged(story);
          return settleDivergence(tx, story.id);
        },
        { allowAbandonedTicket: true },
      ),
    )
    .post("/api/stories/:id/issue/take-github", (c) =>
      decide(
        c,
        "take_github_issue",
        ["to_validate", "to_rewrite", "ready"],
        async (tx, story) => {
          // The same fields and limits as « Modifier » (decision 018 C): what does not read back or does not fit is not a template.
          const fields = editBody.safeParse(parseIssue(diverged(story)));
          if (!fields.success) throw new Refused("not_template");
          await rewriteStory(tx, story.id, fields.data);
          return settleDivergence(tx, story.id);
        },
      ),
    )
    .post("/api/stories/:id/abandon", (c) =>
      decide(
        c,
        "abandon_story",
        [
          "to_validate",
          "to_rewrite",
          "ready",
          "in_progress",
          "in_review",
          "done",
        ],
        (tx, story) => updateStory(tx, story.id, { status: "abandoned" }),
      ),
    );
}
