import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { and, asc, count, eq, ilike, isNull, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { sha256 } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  mcpTokens,
  projectMembers,
  projects,
  storyDependencies,
  tickets,
  userStories,
  users,
} from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import type { ReadInstance } from "./instance.ts";
import { memberProject, memberProjects } from "./projects.ts";
import { activeRunId, finishRun, reportStep, startRun } from "./runs.ts";
import {
  changeStory,
  memberStory,
  rewriteStory,
  storyParts,
  storyStatuses,
  storyToRewrite,
  ticketNeedsStories,
  ticketStories,
  WrongStatus,
} from "./stories.ts";
import { AGENT_NAME } from "./team.ts";
import {
  assertActive,
  createTicket,
  criterionText,
  descriptionMd,
  memberTicket,
  narrative,
  noNul,
  ticketStep,
  title,
} from "./tickets.ts";

// Decision 016. The body is read whole in memory: same 256 KiB as the API routes (the global limit only covers /api/*).
const MAX_BODY = 256 * 1024;
const MAX_RESULTS = 20;
/** Per ticket, over all the calls that write it (decision 017 B). */
const MAX_STORIES = 100;

/** The caller of a tool and what the call writes to the history. `entry` is filled in as the call learns the ids it concerns. */
type Call = { db: Db; userId: number; entry: Entry; readGitHub: ReadGitHub };

/** Arguments that do not fit the schema of the tool; `fields` names the faulty ones, for Claude only (the history gets the fixed code). */
class InvalidArguments extends Refused {
  fields: string;
  constructor(fields: string) {
    super("invalid_arguments");
    this.fields = fields;
  }
}

/** A refusal that tells Claude how many stories the ticket really has (the history gets the fixed code only). */
class WrittenCount extends Refused {
  written: number;
  constructor(code: string, written: number) {
    super(code);
    this.written = written;
  }
}

/** Invalid arguments found once the stories already written are known: the entry is left as zod's checks leave it (no ids, no arguments), for consistency with the refusals of the same inputs that zod gives (decision 016 F). */
function invalidAfterRead(call: Call, fields: string) {
  call.entry.args = {};
  call.entry.projectId = undefined;
  call.entry.ticketId = undefined;
  return new InvalidArguments(fields);
}

/** Writes the `refused` entry of a call that stops before its work: `act` records the refusal and rethrows it. */
const refuse = (db: Db, entry: Entry, error: Refused): Promise<never> =>
  act(db, entry, async () => {
    throw error;
  });

/** A project of the caller, or a journaled `not_found` (someone else's project looks like no project). */
async function ownProject(call: Call, id: number) {
  const project = await memberProject(call.db, call.userId, id);
  if (!project) return refuse(call.db, call.entry, new Refused("not_found"));
  call.entry.projectId = project.id;
  return project;
}

// The safe subset of Git's branch names (decision 033 B); `..` is refused next to it.
const BRANCH = /^[A-Za-z0-9._][A-Za-z0-9._/-]*(?<![/.])$/;

const id = z.number().int().min(1).max(2_147_483_647);

/** Rows of a project the user belongs to and has not archived (what `search` and `list_tickets_needing_us` look at). */
const activeOf = (userId: number) =>
  and(eq(projectMembers.userId, userId), isNull(projects.archivedAt));

// Limits of decision 017 B (shared with the REST edit of a story): the notes are kept as typed.
const storyText = {
  as_a: narrative.describe("The role, e.g. 'project owner' (no 'As a' prefix)"),
  i_want: narrative.describe("What the user wants, without 'I want'"),
  so_that: narrative.describe("The benefit, without 'so that'"),
  notes_md: descriptionMd
    .optional()
    .describe("Markdown notes for the developer, up to 50,000 characters"),
  criteria: z
    .array(
      z.object({
        given: criterionText.describe("The starting state"),
        when: criterionText.describe("The action"),
        // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the tool (decision 004)
        then: criterionText.describe("The observable result"),
      }),
    )
    .min(1)
    .max(20)
    .describe("1 to 20 testable acceptance criteria"),
};
const storyInput = z.object({
  ...storyText,
  depends_on: z
    .array(z.number().int())
    .max(99)
    .optional()
    .describe(
      "Positions in the ticket (1 = the first story ever written for it, including earlier calls) of EARLIER stories this one needs first",
    ),
});

/** `depends_on` holds positive positions, each once (decision 017 C); that they are strictly earlier needs the stories already written, so `create_user_stories` checks it in its transaction. The refusal names the faulty field. */
const storyList = z
  .array(storyInput)
  .max(20)
  .superRefine((list, ctx) => {
    list.forEach((story, index) => {
      const seen = new Set<number>();
      story.depends_on?.forEach((position, at) => {
        const problem =
          position < 1
            ? `position ${position} must be at least 1`
            : seen.has(position) && `position ${position} is repeated`;
        seen.add(position);
        if (problem)
          ctx.addIssue({
            code: "custom",
            path: [index, "depends_on", at],
            message: problem,
          });
      });
    });
  });

/** A tool: validates its arguments, then runs. `inputSchema` is what `tools/list` shows Claude. */
function tool<S extends z.ZodObject>(
  description: string,
  schema: S,
  run: (call: Call, args: z.output<S>) => Promise<unknown>,
) {
  return {
    description,
    inputSchema: z.toJSONSchema(schema, { io: "input" }),
    async call(call: Call, raw: unknown) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const fields = parsed.error.issues
          .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
          .join("; ");
        return refuse(call.db, call.entry, new InvalidArguments(fields));
      }
      return run(call, parsed.data);
    },
  };
}

// The descriptions are the product (decision 004): they are written so that a vague request leads to the right tool.
const tools = {
  list_projects: tool(
    "List the projects the user works on in Cockpit (id, GitHub name, default branch). Use it first when the user mentions a project by name or asks what they have, to get the project_id the other tools need. Archived projects are not listed.",
    z.object({}),
    async (call) =>
      act(call.db, call.entry, async (tx) => ({
        projects: (await memberProjects(tx, call.userId))
          .filter((p) => !p.archivedAt)
          .map((p) => ({
            id: p.id,
            full_name: p.fullName,
            default_branch: p.defaultBranch,
          })),
      })),
  ),

  get_project: tool(
    "Get one project: its details, the CLAUDE.md of its repository (empty when it has none; claude_md_unreachable is true when GitHub can no longer be reached for this repo) and its tickets (id, title, step: new, to_validate, validated, in_progress, done or abandoned). Use it to learn a project's rules and to see what ideas are already noted before creating a ticket. Works on archived projects too.",
    z.object({ project_id: id.describe("Id from list_projects or search") }),
    async (call, { project_id }) => {
      call.entry.args = { projectId: project_id };
      const project = await ownProject(call, project_id);
      // GitHub is read before the transaction, which would otherwise hold a connection for up to three calls of 10 s each. A failure waits for `act`, which writes its one `error` entry.
      let claudeMd: string | null = "";
      let failed: unknown;
      try {
        const ready = await call.readGitHub();
        if (!ready) throw new Error("Cockpit is not configured");
        claudeMd = await ready.github.readClaudeMd(
          project.installationId,
          project.fullName,
        );
      } catch (error) {
        failed = error;
      }
      return act(call.db, call.entry, async (tx) => {
        if (failed) throw failed;
        const rows = await tx
          .select()
          .from(tickets)
          .where(eq(tickets.projectId, project.id))
          .orderBy(asc(tickets.id));
        const statuses = await storyStatuses(
          tx,
          rows.map((t) => t.id),
        );
        return {
          project: {
            id: project.id,
            full_name: project.fullName,
            default_branch: project.defaultBranch,
            archived: project.archivedAt !== null,
          },
          // null: the App lost access to the repo; the project and its tickets are still worth returning.
          claude_md: claudeMd ?? "",
          claude_md_unreachable: claudeMd === null,
          tickets: rows.map((t) => ({
            id: t.id,
            title: t.title,
            step: ticketStep(t, statuses.get(t.id) ?? []),
          })),
        };
      });
    },
  ),

  search: tool(
    "Search by words, when the user refers to a ticket or a project by a few words (for example 'the login idea on GestionProjet'). Every word must appear, whatever the case, in a project name, a ticket title or the narrative of a user story (as a / I want / so that, not the notes); there is no spelling or synonym handling, so try other words (or get_project to list a project's tickets, or get_ticket for its stories) when nothing comes back. At most 20 results, archived projects excluded.",
    z.object({
      query: z
        .string()
        .trim()
        .min(2)
        .max(200)
        .refine(noNul)
        .describe("Words to find, 2 to 200 characters"),
      project_id: id
        .optional()
        .describe("Only search the tickets of this project"),
    }),
    async (call, { query, project_id }) => {
      if (project_id !== undefined) {
        call.entry.args = { projectId: project_id };
        await ownProject(call, project_id);
      }
      // LIKE wildcards in the query are plain characters.
      const words = query.split(/\s+/).map((w) => w.replace(/[\\%_]/g, "\\$&"));
      const matching = (column: AnyPgColumn | SQL) =>
        and(...words.map((word) => ilike(column, `%${word}%`)));
      const mine = activeOf(call.userId);
      return act(call.db, call.entry, async (tx) => {
        const found =
          project_id === undefined
            ? await tx
                .select({ id: projects.id, fullName: projects.fullName })
                .from(projects)
                .innerJoin(
                  projectMembers,
                  eq(projectMembers.projectId, projects.id),
                )
                .where(and(mine, matching(projects.fullName)))
                .orderBy(asc(projects.id))
                .limit(MAX_RESULTS)
            : [];
        const foundTickets = await tx
          .select({ ticket: tickets })
          .from(tickets)
          .innerJoin(projects, eq(projects.id, tickets.projectId))
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(
            and(
              mine,
              matching(tickets.title),
              project_id === undefined
                ? undefined
                : eq(tickets.projectId, project_id),
            ),
          )
          .orderBy(asc(tickets.id))
          .limit(MAX_RESULTS);
        const foundStories = await tx
          .select({ story: userStories, projectId: tickets.projectId })
          .from(userStories)
          .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
          .innerJoin(projects, eq(projects.id, tickets.projectId))
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(
            and(
              mine,
              matching(
                sql`${userStories.asA} || ' ' || ${userStories.iWant} || ' ' || ${userStories.soThat}`,
              ),
              project_id === undefined
                ? undefined
                : eq(tickets.projectId, project_id),
            ),
          )
          .orderBy(asc(userStories.id))
          .limit(MAX_RESULTS);
        const statuses = await storyStatuses(
          tx,
          foundTickets.map(({ ticket }) => ticket.id),
        );
        return {
          results: [
            ...found.map((p) => ({
              type: "project",
              id: p.id,
              title: p.fullName,
              project_id: p.id,
            })),
            ...foundTickets.map(({ ticket }) => ({
              type: "ticket",
              id: ticket.id,
              title: ticket.title,
              project_id: ticket.projectId,
              step: ticketStep(ticket, statuses.get(ticket.id) ?? []),
            })),
            ...foundStories.map(({ story, projectId }) => ({
              type: "story",
              id: story.id,
              title: story.iWant,
              project_id: projectId,
              ticket_id: story.ticketId,
              status: story.status,
            })),
          ].slice(0, MAX_RESULTS),
        };
      });
    },
  ),

  get_ticket: tool(
    "Get one ticket: its title, its description in markdown, its step and its user stories (id, position, status, i_want; use get_user_story for one story in full). Use it when you have a ticket_id (from search or get_project) and need the whole idea. Works on tickets of archived projects too.",
    z.object({ ticket_id: id.describe("Id from search or get_project") }),
    async (call, { ticket_id }) => {
      call.entry.args = { ticketId: ticket_id };
      const found = await memberTicket(call.db, call.userId, ticket_id);
      if (!found) return refuse(call.db, call.entry, new Refused("not_found"));
      const { ticket } = found;
      call.entry.projectId = ticket.projectId;
      call.entry.ticketId = ticket.id;
      return act(call.db, call.entry, async (tx) => {
        const stories = await ticketStories(tx, ticket.id);
        return {
          id: ticket.id,
          project_id: ticket.projectId,
          title: ticket.title,
          description_md: ticket.descriptionMd,
          step: ticketStep(
            ticket,
            stories.map((story) => story.status),
          ),
          stories: stories.map((story) => ({
            id: story.id,
            position: story.position,
            status: story.status,
            i_want: story.iWant,
          })),
        };
      });
    },
  ),

  create_ticket: tool(
    "Note a new idea as a ticket in a project (step 'new'). Use it when the user says things like 'note this idea on X' or 'add a ticket'. The title is a short sentence; the description is markdown and optional. It does not start any work. Refused on an archived project.",
    z.object({
      project_id: id.describe("Id from list_projects or search"),
      title: title.describe("Short title, 1 to 200 characters"),
      description_md: descriptionMd
        .optional()
        .describe("Markdown description, up to 50,000 characters"),
    }),
    async (call, args) => {
      call.entry.args = { projectId: args.project_id };
      const project = await ownProject(call, args.project_id);
      const ticket = await createTicket(call.db, call.entry, project.id, {
        title: args.title,
        descriptionMd: args.description_md,
      });
      return {
        id: ticket.id,
        project_id: ticket.projectId,
        title: ticket.title,
        step: ticketStep(ticket, []),
      };
    },
  ),

  list_tickets_needing_us: tool(
    "List the user-story work waiting for Claude: tickets whose stories are not all written yet (id, project, title, description, stories_written: how many stories are already written, above 0 when an earlier writing was interrupted) and user stories the user sent back to be rewritten (with the user's comment). Use it when the user asks to write, split or specify their ideas, or asks what is left to write; pass project_id to look at one project only. At most 20 of each list, oldest first: a ticket leaves the list as soon as its writing is closed, so call again for the next ones. Abandoned tickets and archived projects are left out. Next: get_project for the rules of the repository, get_ticket if you need more, then create_user_stories for the tickets, or update_user_story for stories_to_rewrite (after get_user_story).",
    z.object({
      project_id: id
        .optional()
        .describe("Only look at this project (id from list_projects)"),
    }),
    async (call, { project_id }) => {
      if (project_id !== undefined) {
        call.entry.args = { projectId: project_id };
        await ownProject(call, project_id);
      }
      // An archived project of the caller is not "active": it simply yields nothing, like search.
      const mine = and(
        activeOf(call.userId),
        project_id === undefined ? undefined : eq(projects.id, project_id),
      );
      return act(call.db, call.entry, async (tx) => {
        const needing = await tx
          .select({
            ticket: tickets,
            project: projects.fullName,
            written: count(userStories.id),
          })
          .from(tickets)
          .innerJoin(projects, eq(projects.id, tickets.projectId))
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .leftJoin(userStories, eq(userStories.ticketId, tickets.id))
          .where(and(mine, ticketNeedsStories))
          .groupBy(tickets.id, projects.id)
          .orderBy(asc(tickets.id))
          .limit(MAX_RESULTS);
        const rewrite = await tx
          .select({ story: userStories, projectId: tickets.projectId })
          .from(userStories)
          .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
          .innerJoin(projects, eq(projects.id, tickets.projectId))
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(and(mine, storyToRewrite))
          .orderBy(asc(userStories.id))
          .limit(MAX_RESULTS);
        return {
          tickets: needing.map(({ ticket, project, written }) => ({
            id: ticket.id,
            project_id: ticket.projectId,
            project,
            title: ticket.title,
            description_md: ticket.descriptionMd,
            stories_written: written,
          })),
          stories_to_rewrite: rewrite.map(({ story, projectId }) => ({
            id: story.id,
            ticket_id: story.ticketId,
            project_id: projectId,
            as_a: story.asA,
            i_want: story.iWant,
            so_that: story.soThat,
            rewrite_comment: story.rewriteComment,
          })),
        };
      });
    },
  ),

  create_user_stories: tool(
    "Write the user stories of a ticket, in one call or in several. Use it after reading the ticket (get_ticket) and the rules of the project (get_project). Split the idea into right-sized stories, in the user's language, each with as_a / i_want / so_that, optional markdown notes_md for the developer, and 1 to 20 testable acceptance criteria (given / when / then). A story is right-sized when ONE development session (one branch, one pull request) can build and test it and the user can check its result alone: if it is bigger, cut it into vertical slices (a thin path from screen to data), never by layer; if it is smaller (nothing checkable alone, a rename, one field, only makes sense with the next story), merge it into the story it serves. Never write two similar stories (same goal, overlapping criteria): merge them into one that keeps all their details. Most tickets need 1 to 8 stories. Every call must stay under 256 KiB, so keep notes short. 1 to 20 stories per call, and at most 100 per ticket (beyond that, split the idea into several tickets). more_to_come (default false): with false the ticket's writing is closed after this call and any further call is refused; with true more calls follow, so a very large ticket is written in several calls of coherent groups, in dependency order. If you sent everything with more_to_come true, close the writing with stories: [] (only allowed once the ticket has stories, with more_to_come false). Every call states stories_written, the number of stories already written on the ticket (0 for the first call, then the previous count plus the stories that call created, or the count list_tickets_needing_us or get_ticket gives); if it differs from the real count (a packet sent twice, out of order or in parallel) the call is refused and nothing is written, so send ONE call at a time and wait for its answer. A story with about ten criteria or more is too big: cut it. depends_on lists the positions IN THE TICKET (1 is the first story ever written for it, so later calls continue the numbering) of EARLIER stories that must be done first; never a later or the same position. Each call creates its stories as 'to_validate' or nothing: only the user validates stories, in Cockpit. Refused on abandoned tickets and on archived projects.",
    z.object({
      ticket_id: id.describe("Id from list_tickets_needing_us or get_ticket"),
      stories: storyList.describe(
        "The stories of this call, in order; empty only to close an open writing",
      ),
      more_to_come: z
        .boolean()
        .default(false)
        .describe(
          "True when other calls will add stories to this ticket; false (default) closes the writing",
        ),
      stories_written: z
        .number()
        .int()
        .min(0)
        .max(MAX_STORIES)
        .default(0)
        .describe(
          "How many stories are already written on this ticket (0 for the first call, then the count after the previous call); a different real count is refused",
        ),
    }),
    async (call, args) => {
      call.entry.args = {
        ticketId: args.ticket_id,
        count: args.stories.length,
        moreToCome: args.more_to_come,
      };
      const found = await memberTicket(call.db, call.userId, args.ticket_id);
      if (!found) return refuse(call.db, call.entry, new Refused("not_found"));
      call.entry.projectId = found.project.id;
      call.entry.ticketId = found.ticket.id;
      return act(call.db, call.entry, async (tx) => {
        await assertActive(tx, found.project.id);
        // Locked until the end: a simultaneous call waits, then sees its stories (and a closed writing) and positions its own after them.
        const [ticket] = await tx
          .select()
          .from(tickets)
          .where(eq(tickets.id, found.ticket.id))
          .for("update");
        if (!ticket) throw new Refused("not_found");
        if (ticket.abandonedAt) throw new Refused("ticket_abandoned");
        if (ticket.storiesWrittenAt) throw new Refused("ticket_has_stories");
        const existing = await tx
          .select({
            id: userStories.id,
            position: userStories.position,
            status: userStories.status,
          })
          .from(userStories)
          .where(eq(userStories.ticketId, ticket.id));
        const before = existing.length;
        if (before !== args.stories_written)
          throw new WrittenCount("writing_moved_on", before);
        if (before + args.stories.length > MAX_STORIES)
          throw new WrittenCount("too_many_stories", before);
        if (args.stories.length === 0 && (before === 0 || args.more_to_come))
          throw invalidAfterRead(
            call,
            "stories: send at least one story (an empty list only closes the writing of a ticket that has stories, with more_to_come false)",
          );
        // Positions are those of the ticket: story `index` of this call is at before + index + 1, so it may depend on 1 to before + index.
        args.stories.forEach((story, index) => {
          const at = story.depends_on?.findIndex(
            (position) => position > before + index,
          );
          if (at !== undefined && at >= 0)
            throw invalidAfterRead(
              call,
              `stories.${index}.depends_on.${at}: position ${story.depends_on?.[at]} is not an earlier story (story ${before + index + 1} can depend on positions 1 to ${before + index})`,
            );
        });

        const created =
          args.stories.length === 0
            ? []
            : await tx
                .insert(userStories)
                .values(
                  args.stories.map((story, index) => ({
                    ticketId: ticket.id,
                    position: before + index + 1,
                    asA: story.as_a,
                    iWant: story.i_want,
                    soThat: story.so_that,
                    notesMd: story.notes_md,
                    status: "to_validate" as const,
                  })),
                )
                .returning({
                  id: userStories.id,
                  position: userStories.position,
                });
        const idAt = new Map(
          [...existing, ...created].map((c) => [c.position, c.id]),
        );
        if (created.length > 0)
          await tx.insert(acceptanceCriteria).values(
            args.stories.flatMap((story, index) =>
              story.criteria.map((criterion, at) => ({
                storyId: idAt.get(before + index + 1) as number,
                position: at + 1,
                givenText: criterion.given,
                whenText: criterion.when,
                thenText: criterion.then,
              })),
            ),
          );
        const dependencies = args.stories.flatMap((story, index) =>
          (story.depends_on ?? []).map((position) => ({
            storyId: idAt.get(before + index + 1) as number,
            dependsOnId: idAt.get(position) as number,
          })),
        );
        if (dependencies.length > 0)
          await tx.insert(storyDependencies).values(dependencies);
        if (!args.more_to_come)
          await tx
            .update(tickets)
            .set({ storiesWrittenAt: sql`now()` })
            .where(eq(tickets.id, ticket.id));
        return {
          ticket_id: ticket.id,
          step: ticketStep(ticket, [
            ...existing.map((e) => e.status),
            ...created.map(() => "to_validate" as const),
          ]),
          more_to_come: args.more_to_come,
          stories: created
            .map(({ id, position }) => ({ id, position }))
            .sort((a, b) => a.position - b.position),
        };
      });
    },
  ),

  update_user_story: tool(
    "Rewrite a user story the user sent back (status to_rewrite), then hand it back for validation (it becomes to_validate). Use it when list_tickets_needing_us lists the story in stories_to_rewrite, or the user asks you to rewrite a story they sent back. Read the story and its rewrite_comment with get_user_story first, and answer that comment. Only to_rewrite stories can be rewritten: any other status is refused, and only the user validates, sends back, edits or abandons stories, in Cockpit. Send the full text: as_a, i_want, so_that, optional notes_md (send it only to change the notes: left out, they are kept; an empty string clears them) and the COMPLETE list of criteria (1 to 20), which replaces the old list as a whole, so repeat the criteria that were right. The limits and the right size are those of create_user_stories (one development session per story, no two similar stories). The dependencies of the story are kept. Refused on abandoned tickets and on archived projects.",
    z.object({
      story_id: id.describe("Id from list_tickets_needing_us or get_ticket"),
      ...storyText,
    }),
    async (call, args) => {
      call.entry.args = { storyId: args.story_id };
      const found = await memberStory(call.db, call.userId, args.story_id);
      if (!found) return refuse(call.db, call.entry, new Refused("not_found"));
      const story = await changeStory(
        call.db,
        call.entry,
        found,
        ["to_rewrite"],
        (tx, locked) =>
          rewriteStory(
            tx,
            locked.id,
            {
              asA: args.as_a,
              iWant: args.i_want,
              soThat: args.so_that,
              notesMd: args.notes_md,
              criteria: args.criteria,
            },
            { status: "to_validate", rewriteComment: null },
          ),
      );
      const { criteria } = await storyParts(call.db, story.id);
      return {
        story: { id: story.id, status: story.status },
        criteria: criteria.map((k) => ({
          id: k.id,
          position: k.position,
          given: k.givenText,
          when: k.whenText,
          // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the tool (decision 004)
          then: k.thenText,
        })),
      };
    },
  ),

  get_user_story: tool(
    "Get one user story in full: its narrative (as_a, i_want, so_that), notes in markdown, status, the user's rewrite_comment when it was sent back, its acceptance criteria (id, given / when / then), the stories it depends on (with their status), its ticket and its project (name, default branch, archived or not). Use it when you have a story_id (from search, get_ticket or list_tickets_needing_us) and need the details to understand, rewrite or implement it. Works on archived projects too.",
    z.object({
      story_id: id.describe(
        "Id from search, get_ticket or list_tickets_needing_us",
      ),
    }),
    async (call, { story_id }) => {
      call.entry.args = { storyId: story_id };
      const found = await memberStory(call.db, call.userId, story_id);
      if (!found) return refuse(call.db, call.entry, new Refused("not_found"));
      const { story, ticket, project } = found;
      call.entry.projectId = project.id;
      call.entry.ticketId = ticket.id;
      call.entry.storyId = story.id;
      return act(call.db, call.entry, async (tx) => {
        const { criteria, dependsOn } = await storyParts(tx, story.id);
        return {
          story: {
            id: story.id,
            position: story.position,
            as_a: story.asA,
            i_want: story.iWant,
            so_that: story.soThat,
            notes_md: story.notesMd,
            status: story.status,
            rewrite_comment: story.rewriteComment,
            branch: story.branch,
            active_run_id: await activeRunId(tx, story.id),
          },
          criteria: criteria.map((k) => ({
            id: k.id,
            position: k.position,
            given: k.givenText,
            when: k.whenText,
            // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the tool (decision 004)
            then: k.thenText,
          })),
          depends_on: dependsOn.map((d) => ({
            id: d.id,
            status: d.status,
            i_want: d.iWant,
          })),
          ticket: { id: ticket.id, title: ticket.title },
          project: {
            id: project.id,
            full_name: project.fullName,
            default_branch: project.defaultBranch,
            archived: project.archivedAt !== null,
          },
        };
      });
    },
  ),

  start_run: tool(
    "Start a development run on a ready user story (status ready), once its branch is prepared. Use it at the start of /dev-us, before the first step. The story becomes in_progress and keeps the branch; only one run can be active per story. Send the git branch name, the model of this session and optionally a comment. Answers the run_id (needed by report_step and finish_run) and the story with its criteria. Refused when the story is not ready, already has an active run, has another branch recorded, or the project is archived.",
    z.object({
      story_id: id.describe("Id of a ready story, from get_user_story"),
      branch: z
        .string()
        .min(1)
        .max(255)
        .regex(BRANCH)
        .refine((b) => !b.includes(".."))
        .describe("The git branch of the story, e.g. us/42-login"),
      model: z
        .string()
        .min(1)
        .max(100)
        .refine(noNul)
        .describe("The model of this session"),
      comment: z
        .string()
        .max(10_000)
        .refine(noNul)
        .optional()
        .describe("An optional note"),
    }),
    async (call, args) => {
      const found = await memberStory(call.db, call.userId, args.story_id);
      if (!found) return refuse(call.db, call.entry, new Refused("not_found"));
      const { runId, story, criteria } = await startRun(
        call.db,
        call.userId,
        call.readGitHub,
        call.entry,
        found,
        args,
      );
      return {
        run_id: runId,
        story: {
          id: story.id,
          status: story.status,
          branch: story.branch,
          active_run_id: runId,
        },
        criteria: criteria.map((k) => ({
          id: k.id,
          position: k.position,
          given: k.givenText,
          when: k.whenText,
          // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the tool (decision 004)
          then: k.thenText,
        })),
      };
    },
  ),

  report_step: tool(
    "Report that an agent of the team starts or finishes a step of the run. Call it with event started just before the agent works and with event finished (and its status, succeeded or failed, and a short summary) right after. A redone step is a new started. Answers step_id and stop_requested (always false for now). Refused when the run is finished, when the agent already has an open step (started) or has none (finished).",
    z
      .object({
        run_id: id.describe("The run_id of start_run"),
        agent: z
          .string()
          .max(255)
          .regex(AGENT_NAME)
          .describe("The agent name, e.g. developer"),
        event: z.enum(["started", "finished"]),
        status: z
          .enum(["succeeded", "failed"])
          .optional()
          .describe("Required with event finished"),
        summary: z.string().max(10_000).refine(noNul).optional(),
      })
      .refine((a) => a.event === "started" || a.status !== undefined, {
        message: "status is required with event finished",
        path: ["status"],
      }),
    (call, args) => reportStep(call.db, call.userId, call.entry, args),
  ),

  finish_run: tool(
    "Finish the run: succeeded once the pull request is open, failed when you stop on a failure. Steps still open are closed as failed and the story becomes ready again. Send a summary of what was done or why it stopped (1 to 10,000 characters). Refused when the run is already finished.",
    z.object({
      run_id: id.describe("The run_id of start_run"),
      outcome: z.enum(["succeeded", "failed"]),
      summary: z.string().min(1).max(10_000).refine(noNul),
    }),
    (call, args) =>
      finishRun(call.db, call.userId, call.readGitHub, call.entry, args),
  ),
};

const TOOL_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/** What Claude reads after a refusal: why, and what to do (decision 004). */
const ADVICE: Record<string, string | ((written: number) => string)> = {
  not_found:
    "not found. The project, ticket or story does not exist or is not yours. Find the right id with list_projects, search or list_tickets_needing_us, then call again.",
  wrong_status:
    "the story is not ready. Only a ready story can start a run: check get_user_story, and tell the user if it needs their validation.",
  run_active:
    "this story already has an active run. Use its run_id (get_user_story gives active_run_id), or finish it with finish_run.",
  branch_mismatch:
    "another branch is already recorded on this story. Use the branch given by get_user_story (branch).",
  run_finished:
    "this run is finished. Start a new one with start_run if the story is ready.",
  step_open:
    "this agent already has an open step. Report it finished before starting another.",
  no_open_step: "this agent has no open step. Report started first.",
  project_archived:
    "this project is archived, so it is read-only. Tell the user, or use another project from list_projects.",
  ticket_abandoned:
    "this ticket is abandoned, so none of its stories can be written or rewritten. Tell the user, or pick another ticket from list_tickets_needing_us.",
  ticket_has_stories:
    "this ticket's stories are already written and its writing is closed (a call without more_to_come closes it). Read them with get_ticket and get_user_story; do not write them again. If they are wrong, tell the user, who can send them back for a rewrite in Cockpit.",
  too_many_stories: (written) =>
    `this ticket would have more than 100 user stories (${written} are written, so ${MAX_STORIES - written} more fit). ${written < MAX_STORIES ? "Send at most that many, with more_to_come false, or close" : "Close"} the writing with stories: [] (otherwise the ticket stays open). The idea is too big for one ticket: tell the user to split it into several tickets, and write the stories of each.`,
  writing_moved_on: (written) =>
    `${written} stories are already written on this ticket. Read them with get_ticket, then send only the missing ones with stories_written: ${written} (their positions start at ${written + 1}). Send one call at a time.`,
  unknown_tool:
    "unknown tool. Use only the tools this server lists (tools/list).",
};

function failure(error: unknown) {
  if (error instanceof WrongStatus)
    return `Refused: this story is ${error.status}, not to_rewrite. Only stories the user sent back (status to_rewrite) can be rewritten; check list_tickets_needing_us or get_user_story. Do not retry; tell the user if the story needs changes.`;
  if (error instanceof InvalidArguments)
    return `Refused: invalid arguments (${error.fields}). Fix them and call the tool again.`;
  if (error instanceof Refused) {
    const advice = ADVICE[error.message] ?? error.message;
    return `Refused: ${typeof advice === "function" ? advice(error instanceof WrittenCount ? error.written : 0) : advice}`;
  }
  return "Error: the call failed (GitHub or the server did not answer as expected). Retry in a moment; if it keeps failing, tell the user.";
}

/** One tools/call. Whatever happens, one history entry is left (by `act`), and the outcome is a tool result: a refusal or an error is read by Claude, not a protocol error. */
async function callTool(
  base: Omit<Call, "entry">,
  tokenId: number,
  name: string,
  args: unknown,
): Promise<CallToolResult> {
  const known = Object.hasOwn(tools, name)
    ? tools[name as keyof typeof tools]
    : undefined;
  const entry: Entry = {
    userId: base.userId,
    tokenId,
    actor: "claude",
    origin: "mcp",
    // A name Claude made up is journaled as is only when it is a short identifier (decision 016).
    action: known || TOOL_NAME.test(name) ? name : "unknown_tool",
    args: {},
  };
  const call = { ...base, entry };
  try {
    const data = known
      ? await known.call(call, args ?? {})
      : await refuse(call.db, entry, new Refused("unknown_tool"));
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: failure(error) }] };
  }
}

/** Who sends the request, or why nobody (a fixed code; `tokenId` once the token was found). */
async function authenticate(db: Db, header: string | undefined) {
  if (header === undefined) return { reason: "missing_token" };
  const secret = /^Bearer +(\S+)$/i.exec(header)?.[1];
  const [found] = secret
    ? await db
        .select({ token: mcpTokens, blockedAt: users.blockedAt })
        .from(mcpTokens)
        .innerJoin(users, eq(users.id, mcpTokens.userId))
        .where(eq(mcpTokens.tokenHash, sha256(secret)))
    : [];
  if (!found) return { reason: "invalid_token" };
  const { token } = found;
  if (token.revokedAt) return { reason: "revoked_token", tokenId: token.id };
  if (found.blockedAt) return { reason: "blocked_user", tokenId: token.id };
  // An OAuth access token lives an hour (decision 021 D); the client then uses its refresh token.
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now())
    return { reason: "expired_token", tokenId: token.id };
  return { userId: token.userId, tokenId: token.id };
}

/** The MCP server (decisions 004 and 016): one POST, one JSON-RPC request, answered as JSON. Nothing is kept between two requests, so there is no session to lose. */
export function mcpRoutes(
  db: Db,
  readGitHub: ReadGitHub,
  readInstance: ReadInstance,
  version: string,
) {
  return (
    new Hono()
      .post("/mcp", async (c) => {
        const caller = await authenticate(db, c.req.header("authorization"));
        if ("reason" in caller) {
          // Nothing was presented: no entry, or anyone could grow the history for free (decision 010 E). Nor for an expired access token: the client refreshes it every hour, as expected (decision 021 F).
          if (
            caller.reason !== "missing_token" &&
            caller.reason !== "expired_token"
          ) {
            const entry: Entry = {
              userId: null,
              tokenId: caller.tokenId ?? null,
              actor: "claude",
              origin: "mcp",
              action: "mcp_auth",
              args: {},
            };
            await refuse(db, entry, new Refused(caller.reason)).catch(
              (error) => {
                if (!(error instanceof Refused)) throw error;
              },
            );
          }
          // Tells an OAuth client where to start (RFC 9728, decision 021 A).
          const config = await readInstance();
          return c.json({ error: caller.reason }, 401, {
            "WWW-Authenticate": config
              ? `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource"`
              : "Bearer",
          });
        }
        await db
          .update(mcpTokens)
          .set({ lastUsedAt: sql`now()` })
          .where(eq(mcpTokens.id, caller.tokenId));

        const server = new Server(
          { name: "cockpit", version },
          { capabilities: { tools: {} } },
        );
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: Object.entries(tools).map(([name, t]) => ({
            name,
            description: t.description,
            inputSchema: t.inputSchema as { type: "object" },
          })),
        }));
        server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
          callTool(
            { db, userId: caller.userId, readGitHub },
            caller.tokenId,
            params.name,
            params.arguments,
          ),
        );
        // No session id and no stream: the answer is one JSON body.
        const transport = new WebStandardStreamableHTTPServerTransport({
          enableJsonResponse: true,
          maxRequestBodySize: MAX_BODY,
        });
        await server.connect(transport);
        try {
          return await transport.handleRequest(c.req.raw);
        } finally {
          await server.close();
        }
      })
      // Without session there is no stream to open (GET) nor session to close (DELETE).
      .all("/mcp", (c) =>
        c.json({ error: "Method not allowed" }, 405, { Allow: "POST" }),
      )
  );
}
