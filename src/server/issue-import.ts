import { and, eq, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry } from "./action.ts";
import { currentUser } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { acceptanceCriteria, tickets, userStories } from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import { readStoryIssue } from "./issue-story.ts";
import { memberProject } from "./projects.ts";
import { assertActive, body, refusal } from "./tickets.ts";

// Decisions 056 A, C and E (slice 11.3): the open issues of a repo become tickets, or ready stories when they are written as one.

const MENTION = "(tronqué : la suite est sur GitHub)";
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 50_000;
const importBody = z.object({
  numbers: z.array(z.number().int().positive()).min(1).max(200),
});

// PostgreSQL text cannot hold a NUL character, and GitHub's text is a stranger's.
const clean = (text: string | null | undefined) =>
  (text ?? "").replaceAll("\0", "");

/** Behind the gate of `projectRoutes` (503 before the session check). */
export function issueImportRoutes(db: Db, readGitHub: ReadGitHub) {
  /** The issues of the repo as GitHub holds them now. */
  const read = async (project: {
    installationId: number;
    fullName: string;
  }) => {
    const ready = await readGitHub();
    if (!ready) throw new Error("The GitHub App is not configured");
    return ready.github.listIssues(project.installationId, project.fullName);
  };
  /** What of the project already comes from an issue: story (020) or ticket (C), by issue number. */
  const known = async (projectId: number, tx: Pick<Db, "select"> = db) => {
    const stories = await tx
      .select({ number: userStories.issueNumber, storyId: userStories.id })
      .from(userStories)
      .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
      .where(
        and(
          eq(tickets.projectId, projectId),
          isNotNull(userStories.issueNumber),
        ),
      );
    const fromTickets = await tx
      .select({ number: tickets.githubIssueNumber, ticketId: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.projectId, projectId),
          isNotNull(tickets.githubIssueNumber),
        ),
      );
    return new Map<number, { storyId: number } | { ticketId: number }>([
      ...fromTickets.map(
        (t) => [t.number as number, { ticketId: t.ticketId }] as const,
      ),
      ...stories.map(
        (s) => [s.number as number, { storyId: s.storyId }] as const,
      ),
    ]);
  };

  return new Hono()
    .get("/api/projects/:id/issues", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      try {
        const issues = await read(project);
        const inCockpit = await known(project.id);
        return c.json({
          issues: issues.map((issue) => ({
            number: issue.number,
            title: issue.title,
            state: issue.state,
            kind: readStoryIssue(clean(issue.body)) ? "story" : "ticket",
            inCockpit: inCockpit.get(issue.number) ?? null,
          })),
        });
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
    })
    .post("/api/projects/:id/issues/import", body(importBody), async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      if (project.archivedAt) return c.json({ error: "project_archived" }, 409);
      const numbers = [...new Set(c.req.valid("json").numbers)];
      // The page is not believed: the issues are read again.
      let issues: Awaited<ReturnType<typeof read>>;
      try {
        issues = await read(project);
      } catch (error) {
        console.error("GitHub request failed:", error);
        return c.json({ error: "github_unavailable" }, 502);
      }
      const byNumber = new Map(issues.map((i) => [i.number, i]));
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action: "import_issues",
        args: {},
        projectId: project.id,
      };
      try {
        const done = await act(db, entry, async (tx) => {
          await assertActive(tx, project.id);
          const taken = await known(project.id, tx);
          const counts = { tickets: 0, stories: 0, skipped: 0 };
          for (const number of numbers) {
            const issue = byNumber.get(number);
            if (issue?.state !== "open" || taken.has(number)) {
              counts.skipped++;
              continue;
            }
            const text = clean(issue.body);
            const story = readStoryIssue(text);
            // The unique index makes a concurrent import wait, then skip.
            const [ticket] = await tx
              .insert(tickets)
              .values({
                projectId: project.id,
                title: clean(issue.title).slice(0, TITLE_MAX),
                descriptionMd:
                  text.length > DESCRIPTION_MAX
                    ? `${text.slice(0, DESCRIPTION_MAX - MENTION.length - 2)}\n\n${MENTION}`
                    : text,
                githubIssueNumber: number,
                ...(story && { storiesWrittenAt: sql`now()` }),
              })
              .onConflictDoNothing()
              .returning({ id: tickets.id });
            if (!ticket) {
              counts.skipped++;
              continue;
            }
            counts.tickets++;
            if (!story) continue;
            const [row] = await tx
              .insert(userStories)
              .values({
                ticketId: ticket.id,
                position: 1,
                status: "ready",
                asA: story.asA,
                iWant: story.iWant,
                soThat: story.soThat,
                notesMd: "",
                issueNumber: number,
              })
              .returning({ id: userStories.id });
            await tx.insert(acceptanceCriteria).values(
              story.criteria.map((k, index) => ({
                storyId: (row as { id: number }).id,
                position: index + 1,
                givenText: k.given,
                whenText: k.when,
                thenText: k.then,
              })),
            );
            counts.stories++;
          }
          entry.args = counts;
          return counts;
        });
        return c.json(done);
      } catch (error) {
        return refusal(c, error);
      }
    });
}
