import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import { currentUser } from "./auth.ts";
import {
  citation,
  citationRefusal,
  LocatedRefusal,
  MAX_FILES,
  moduleData,
  text,
} from "./code-map.ts";
import type { Db } from "./db/db.ts";
import {
  acceptanceCriteria,
  codeMaps,
  codeSources,
  findings,
  type projects,
  storyDependencies,
  tickets,
  userStories,
} from "./db/schema.ts";
import { permalink } from "./findings.ts";
import type { ReadGitHub } from "./github.ts";
import { isDatabaseId, memberProject } from "./projects.ts";
import { WrongStatus } from "./stories.ts";
import {
  assertActive,
  body,
  checkDependsOn,
  criterionText,
  descriptionMd,
  narrative,
  noNul,
  refusal,
} from "./tickets.ts";

// Decision 047 A: the same bounds on what Claude sends and on what the human corrects.
const summary = z.string().trim().min(1).max(300).refine(noNul);
const ruleText = {
  summary,
  given: criterionText,
  when: criterionText,
  // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the tool (decision 004)
  then: criterionText,
};
const takeoverStory = z.object({
  as_a: narrative,
  i_want: narrative,
  so_that: narrative,
  notes_md: descriptionMd.optional(),
  depends_on: z.array(z.number().int()).max(99).optional(),
  criteria: z
    .array(
      z.object({
        ...ruleText,
        reasoning: text(1_000),
        doubt: text(1_000).optional(),
        sources: z.array(citation).min(1).max(5),
        object_names: z.array(text(200)).max(20).optional(),
      }),
    )
    .min(1)
    .max(5),
});
export const takeoverArgs = z.object({
  project_id: z.number().int().min(1).max(2_147_483_647),
  commit_sha: z.string().regex(/^[0-9a-f]{40}$/),
  // 190 + « Reprise : » stays within the 200 characters of a ticket title (decision 014).
  feature: z.string().trim().min(1).max(190).refine(noNul),
  stories: z
    .array(takeoverStory)
    .min(1)
    .max(20)
    .superRefine(checkDependsOn)
    // All the stories are new: story n can only depend on the n - 1 before it.
    .superRefine((list, ctx) => {
      list.forEach((story, index) => {
        story.depends_on?.forEach((position, at) => {
          if (position > index)
            ctx.addIssue({
              code: "custom",
              path: [index, "depends_on", at],
              message: `position ${position} is not an earlier story (story ${index + 1} can depend on positions 1 to ${index})`,
            });
        });
      });
    }),
});
type Args = z.output<typeof takeoverArgs>;

/** The lines cited by a call, each with the location a refusal names. */
const citationsOf = ({ stories }: Args) =>
  stories.flatMap((s, i) =>
    s.criteria.flatMap((k, j) =>
      k.sources.map((source, n) => ({
        where: `stories[${i}].criteria[${j}].sources[${n}]`,
        ...source,
      })),
    ),
  );

/** `create_takeover_stories` (decision 047 A to C): like `submit_code_map`, GitHub is read before the one transaction that creates the ticket « Reprise : <feature> », its stories, their rules and their sources, or nothing. */
export async function createTakeoverStories(
  db: Db,
  readGitHub: ReadGitHub,
  entry: Entry,
  project: typeof projects.$inferSelect,
  args: Args,
) {
  const citations = citationsOf(args);
  const files = new Set(citations.map((c) => c.path));
  let refused: Refused | undefined = project.archivedAt
    ? new Refused("project_archived")
    : files.size > MAX_FILES
      ? new LocatedRefusal(
          "too_many_files",
          `stories: this call cites ${files.size} distinct files, more than the ${MAX_FILES} allowed in one call. Send the stories in several calls (one ticket each).`,
        )
      : undefined;
  let failed: unknown;
  if (!refused)
    try {
      refused = await citationRefusal(
        readGitHub,
        project,
        args.commit_sha,
        citations,
      );
    } catch (error) {
      failed = error;
    }
  return act(db, entry, async (tx) => {
    if (failed) throw failed;
    if (refused) throw refused;
    await assertActive(tx, project.id);
    const [ticket] = await tx
      .insert(tickets)
      .values({
        projectId: project.id,
        title: `Reprise : ${args.feature}`,
        storiesWrittenAt: sql`now()`,
      })
      .returning({ id: tickets.id });
    if (!ticket) throw new Error("ticket not created");
    entry.ticketId = ticket.id;
    entry.args = {
      projectId: project.id,
      ticketId: ticket.id,
      stories: args.stories.length,
      criteria: args.stories.reduce((n, s) => n + s.criteria.length, 0),
    };
    const created = await tx
      .insert(userStories)
      .values(
        args.stories.map((story, index) => ({
          ticketId: ticket.id,
          position: index + 1,
          asA: story.as_a,
          iWant: story.i_want,
          soThat: story.so_that,
          notesMd: story.notes_md,
          status: "to_validate" as const,
          kind: "takeover" as const,
        })),
      )
      .returning({ id: userStories.id, position: userStories.position });
    const idAt = new Map(created.map((c) => [c.position, c.id]));
    for (const [index, story] of args.stories.entries()) {
      const storyId = idAt.get(index + 1) as number;
      const criteria = await tx
        .insert(acceptanceCriteria)
        .values(
          story.criteria.map((k, at) => ({
            storyId,
            position: at + 1,
            givenText: k.given,
            whenText: k.when,
            thenText: k.then,
            summary: k.summary,
            reasoning: k.reasoning,
            doubt: k.doubt,
            objectNames: k.object_names ?? [],
            takeoverState: "pending" as const,
          })),
        )
        .returning({ id: acceptanceCriteria.id });
      await tx.insert(codeSources).values(
        story.criteria.flatMap((k, at) =>
          k.sources.map((source, position) => ({
            criterionId: (criteria[at] as { id: number }).id,
            position,
            path: source.path,
            startLine: source.start_line,
            endLine: source.end_line,
            commitSha: args.commit_sha,
          })),
        ),
      );
    }
    const dependencies = args.stories.flatMap((story, index) =>
      (story.depends_on ?? []).map((position) => ({
        storyId: idAt.get(index + 1) as number,
        dependsOnId: idAt.get(position) as number,
      })),
    );
    if (dependencies.length > 0)
      await tx.insert(storyDependencies).values(dependencies);
    return {
      ticket_id: ticket.id,
      stories: created
        .map(({ id, position }) => ({ id, position }))
        .sort((a, b) => a.position - b.position),
    };
  });
}

/** The sources of some criteria, in the order of each rule. */
export async function sourcesOf(db: Db, criterionIds: number[]) {
  const byCriterion = new Map<number, (typeof codeSources.$inferSelect)[]>();
  if (criterionIds.length === 0) return byCriterion;
  const found = await db
    .select()
    .from(codeSources)
    .where(inArray(codeSources.criterionId, criterionIds))
    .orderBy(asc(codeSources.criterionId), asc(codeSources.position));
  for (const s of found) {
    const id = s.criterionId as number;
    byCriterion.set(id, [...(byCriterion.get(id) ?? []), s]);
  }
  return byCriterion;
}

/** The valid modules of the map of a project. */
async function mapModules(db: Db, projectId: number) {
  const modules: z.output<typeof moduleData>[] = [];
  for (const m of await db
    .select({ data: codeMaps.data })
    .from(codeMaps)
    .where(eq(codeMaps.projectId, projectId))) {
    const parsed = moduleData.safeParse(m.data);
    if (parsed.success) modules.push(parsed.data);
  }
  return modules;
}

/** The rules of a project as the takeover screen reads them (decision 047 I): those of its takeover stories to validate, or one rule whatever its story; or, for the features (decision 048 A), those of the takeover stories not abandoned of the tickets not abandoned. */
async function loadRules(
  db: Db,
  projectId: number,
  which: "to_validate" | "features" | number = "to_validate",
  modules?: Awaited<ReturnType<typeof mapModules>>,
) {
  const rows = await db
    .select({
      criterion: acceptanceCriteria,
      story: userStories,
      ticketTitle: tickets.title,
    })
    .from(acceptanceCriteria)
    .innerJoin(userStories, eq(userStories.id, acceptanceCriteria.storyId))
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .where(
      and(
        eq(tickets.projectId, projectId),
        eq(userStories.kind, "takeover"),
        which === "to_validate"
          ? eq(userStories.status, "to_validate")
          : which === "features"
            ? and(
                ne(userStories.status, "abandoned"),
                isNull(tickets.abandonedAt),
              )
            : eq(acceptanceCriteria.id, which),
      ),
    )
    .orderBy(
      asc(tickets.id),
      asc(userStories.position),
      asc(acceptanceCriteria.position),
    );
  const sources = await sourcesOf(
    db,
    rows.map((r) => r.criterion.id),
  );
  const inMap = new Set(
    (modules ?? (await mapModules(db, projectId))).flatMap((m) =>
      m.objects.map((o) => o.name),
    ),
  );
  return rows.map(({ criterion: k, story, ticketTitle }) => ({
    id: k.id,
    storyId: story.id,
    // Widened to string: the web's test fixture (FakeFeature) types it as string, and the web only compares it with « to_validate ».
    storyStatus: story.status as string,
    asA: story.asA,
    ticketId: story.ticketId,
    ticketTitle,
    position: k.position,
    summary: k.summary ?? "",
    reasoning: k.reasoning ?? "",
    doubt: k.doubt,
    given: k.givenText,
    when: k.whenText,
    // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the API (decision 017)
    then: k.thenText,
    // Frozen is computed, not stored: the story is merged and the rule's test passed (decision 050 F).
    state:
      which === "features" && story.status === "done" && k.result === "passed"
        ? ("frozen" as const)
        : (k.takeoverState ?? "pending"),
    objects: (k.objectNames ?? []).map((name) => ({
      name,
      inMap: inMap.has(name),
    })),
    sources: (sources.get(k.id) ?? []).map((s) => ({
      path: s.path,
      startLine: s.startLine,
      endLine: s.endLine,
      commitSha: s.commitSha,
    })),
  }));
}

/** Decision 048 A to C: the features (one per takeover ticket) with their actors and rules, and the links of the map between the objects those rules cite. */
async function loadFeatures(db: Db, projectId: number) {
  const modules = await mapModules(db, projectId);
  const rules = await loadRules(db, projectId, "features", modules);
  const features = new Map<
    number,
    {
      id: number;
      title: string;
      actors: string[];
      rules: Omit<
        (typeof rules)[number],
        "asA" | "ticketId" | "ticketTitle" | "position" | "reasoning" | "doubt"
      >[];
    }
  >();
  for (const {
    asA,
    ticketId,
    ticketTitle,
    position,
    reasoning,
    doubt,
    ...rule
  } of rules) {
    const feature = features.get(ticketId) ?? {
      id: ticketId,
      title: ticketTitle.replace(/^Reprise : /, ""),
      actors: [],
      rules: [],
    };
    features.set(ticketId, feature);
    const actor = asA.trim();
    if (!feature.actors.some((a) => a.toLowerCase() === actor.toLowerCase()))
      feature.actors.push(actor);
    feature.rules.push(rule);
  }
  const cited = new Set(rules.flatMap((r) => r.objects.map((o) => o.name)));
  const links = new Map<string, { from: string; to: string; kind: string }>();
  for (const { from, to, kind } of modules.flatMap((m) => m.links))
    if (from !== to && cited.has(from) && cited.has(to))
      links.set(JSON.stringify([from, to, kind]), { from, to, kind });
  return { features: [...features.values()], links: [...links.values()] };
}

/** The human decisions on the rules of the takeover screen (decision 047 E and H). Claude decides none of them: there is no tool for it. */
export function takeoverRoutes(db: Db) {
  const editBody = z.object(ruleText);

  /** One decision on one rule, in one `act`: the caller's rule, its story locked, then `change`; answers with what `answer` makes of its result. */
  const decide = async <T, R extends object>(
    c: Parameters<typeof currentUser>[1],
    action: string,
    change: (
      tx: Tx,
      rule: typeof acceptanceCriteria.$inferSelect,
      found: { projectId: number; fullName: string; storyId: number },
    ) => Promise<T>,
    answer: (result: T, projectId: number, id: number) => Promise<R>,
  ) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const id = Number(c.req.param("id"));
    const [found] = isDatabaseId(id)
      ? await db
          .select({ story: userStories, ticket: tickets })
          .from(acceptanceCriteria)
          .innerJoin(
            userStories,
            eq(userStories.id, acceptanceCriteria.storyId),
          )
          .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
          .where(eq(acceptanceCriteria.id, id))
      : [];
    const project =
      found &&
      (await memberProject(
        db,
        user.userId,
        found.ticket.projectId,
        "can_validate",
      ));
    if (!found || !project) return c.json({ error: "Not found" }, 404);
    const entry: Entry = {
      userId: user.userId,
      actor: "human",
      origin: "ui",
      action,
      args: { criterionId: id },
      projectId: project.id,
      ticketId: found.ticket.id,
      storyId: found.story.id,
    };
    try {
      const result = await act(db, entry, async (tx) => {
        await assertActive(tx, project.id);
        // The story first, like `changeStory`: a decision on one of its rules waits for any other on the story.
        await tx
          .select({ id: userStories.id })
          .from(userStories)
          .where(eq(userStories.id, found.story.id))
          .for("update");
        const [rule] = await tx
          .select()
          .from(acceptanceCriteria)
          .where(eq(acceptanceCriteria.id, id))
          .for("update");
        if (!rule) throw new Refused("not_found");
        if (rule.takeoverState === null) throw new Refused("not_takeover");
        // Read, not locked: same order as `changeStory` (a story, then never a ticket).
        const [parent] = await tx
          .select({ abandonedAt: tickets.abandonedAt })
          .from(tickets)
          .where(eq(tickets.id, found.ticket.id));
        if (parent?.abandonedAt) throw new Refused("ticket_abandoned");
        // Read under the lock: only a story to validate has rules to decide.
        const [locked] = await tx
          .select({ status: userStories.status })
          .from(userStories)
          .where(eq(userStories.id, found.story.id));
        if (locked && locked.status !== "to_validate")
          throw new WrongStatus(locked.status);
        return change(tx, rule, {
          projectId: project.id,
          fullName: project.fullName,
          storyId: found.story.id,
        });
      });
      return c.json(await answer(result, project.id, id));
    } catch (error) {
      return refusal(c, error);
    }
  };

  const setState =
    (state: "pending" | "kept") => (tx: Tx, rule: { id: number }) =>
      tx
        .update(acceptanceCriteria)
        .set({ takeoverState: state })
        .where(eq(acceptanceCriteria.id, rule.id));
  const ruleAnswer = async (_: unknown, projectId: number, id: number) => {
    const [rule] = await loadRules(db, projectId, id);
    if (!rule) throw new Error(`rule ${id} vanished after its decision`);
    return { rule };
  };

  return new Hono()
    .get("/api/projects/:id/rules", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      return c.json({ rules: await loadRules(db, project.id) });
    })
    .get("/api/projects/:id/features", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const project = await memberProject(
        db,
        user.userId,
        Number(c.req.param("id")),
      );
      if (!project) return c.json({ error: "Not found" }, 404);
      return c.json(await loadFeatures(db, project.id));
    })
    .post("/api/criteria/:id/keep", (c) =>
      decide(c, "keep_rule", setState("kept"), ruleAnswer),
    )
    .post("/api/criteria/:id/unkeep", (c) =>
      decide(c, "unkeep_rule", setState("pending"), ruleAnswer),
    )
    .patch("/api/criteria/:id", body(editBody), (c) => {
      const fields = c.req.valid("json");
      return decide(
        c,
        "edit_rule",
        (tx, rule) =>
          tx
            .update(acceptanceCriteria)
            .set({
              summary: fields.summary,
              givenText: fields.given,
              whenText: fields.when,
              thenText: fields.then,
            })
            .where(eq(acceptanceCriteria.id, rule.id)),
        ruleAnswer,
      );
    })
    .post("/api/criteria/:id/bug", (c) =>
      decide(
        c,
        "bug_rule",
        async (tx, rule, { projectId, fullName, storyId }) => {
          const sources = await tx
            .select()
            .from(codeSources)
            .where(eq(codeSources.criterionId, rule.id))
            .orderBy(asc(codeSources.position));
          const description = [
            `**Règle** : ${rule.summary}`,
            `**Raisonnement de Claude** : ${rule.reasoning}`,
            `**Sources**\n${sources.map((s) => `- <${permalink(fullName, s)}>`).join("\n")}`,
          ].join("\n\n");
          const [bug] = await tx
            .insert(tickets)
            .values({
              projectId,
              // The title of a ticket stops at 200 characters (decision 014), cut on whole characters.
              title: Array.from(`Bug : ${rule.summary}`).slice(0, 200).join(""),
              descriptionMd: description,
            })
            .returning({ id: tickets.id, title: tickets.title });
          if (!bug) throw new Error("bug ticket not created");
          // Decision 051 H: the bug stays in the list of findings, with copies of the sources the rule loses (ON DELETE CASCADE).
          const [filed] = await tx
            .insert(findings)
            .values({
              projectId,
              kind: "bug",
              title: bug.title,
              bodyMd: `**Règle** : ${rule.summary}\n\n**Raisonnement de Claude** : ${rule.reasoning}`,
              severity: "medium",
              status: "ticketed",
              ticketId: bug.id,
              commitSha: (sources[0] as { commitSha: string }).commitSha,
            })
            .returning({ id: findings.id });
          await tx.insert(codeSources).values(
            sources.map(({ id: _, criterionId: __, ...s }) => ({
              ...s,
              findingId: (filed as { id: number }).id,
            })),
          );
          await tx
            .delete(acceptanceCriteria)
            .where(eq(acceptanceCriteria.id, rule.id));
          const [left] = await tx
            .select({ id: acceptanceCriteria.id })
            .from(acceptanceCriteria)
            .where(eq(acceptanceCriteria.storyId, storyId))
            .limit(1);
          // A story to validate has no issue yet, so no syncIssue after abandoning it.
          if (!left)
            await tx
              .update(userStories)
              .set({ status: "abandoned", updatedAt: sql`now()` })
              .where(eq(userStories.id, storyId));
          return bug;
        },
        async (ticket) => ({ ticket }),
      ),
    );
}
