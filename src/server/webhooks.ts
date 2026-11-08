import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { act, type Entry, type Tx } from "./action.ts";
import type { Db } from "./db/db.ts";
import {
  history,
  projectMembers,
  projects,
  tickets,
  userStories,
  webhookDeliveries,
} from "./db/schema.ts";
import { githubReader } from "./github.ts";
import { isAlertEvent, receiveAlert } from "./github-alerts.ts";
import { type ReadInstance, WEBHOOK_PATH } from "./instance.ts";
import { renderStory } from "./issues.ts";
import { followPullRequest } from "./pr-follow.ts";
import { NOT_CONFIGURED } from "./projects.ts";
import { memberStory, storyParts } from "./stories.ts";

// GitHub's own limit on a delivery; the 256 KiB of the other /api/* routes does not apply here (decision 024 A).
const MAX_BODY = 25 * 1024 * 1024;
const SIGNATURE = /^sha256=([0-9a-f]{64})$/;
const EVENT = /^[a-z_]{1,64}$/;
const MAX_DELIVERY_ID = 100;
// A delivery that fails this many times is given up on (decision 025 A).
const MAX_ATTEMPTS = 5;
const PULL_EVENTS = ["pull_request", "pull_request_review", "check_suite"];
const PROCESS_EVERY_MS = 60_000;

// An id of the body; a safe integer, so the bigint column of the table can hold it.
const idOf = z.object({ id: z.int().safe() });
const idIn = (value: unknown) => idOf.safeParse(value).data?.id ?? null;

/** The tracked project of a repo and the user it belongs to, for the history entries of a delivery. */
async function projectOfRepo(db: Db | Tx, repoId: number | null) {
  if (repoId === null) return undefined;
  const [project] = await db
    .select({ id: projects.id, userId: projectMembers.userId })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(eq(projects.githubRepoId, repoId));
  return project;
}

type Delivery = typeof webhookDeliveries.$inferSelect;
type Deps = { readInstance: ReadInstance };

const issueEdited = z.object({
  repository: z.object({ id: z.number() }),
  issue: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
  }),
  sender: z.object({ login: z.string() }),
});

/** An issue edited on GitHub (decision 025 B and C): the story keeps GitHub's version when it differs from Cockpit's render, and forgets it when it does not. */
async function handleIssueEdited(db: Db, deps: Deps, delivery: Delivery) {
  const { repository, issue, sender } = issueEdited.parse(delivery.payload);
  const settings = await deps.readInstance();
  if (!settings) throw new Error("The GitHub App is not configured");
  // The App's own edit is the sync of Cockpit.
  if (sender.login === `${settings.githubAppSlug}[bot]`) return;
  const [found] = await db
    .select({
      story: userStories,
      ticket: tickets,
      userId: projectMembers.userId,
    })
    .from(userStories)
    .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projects.githubRepoId, repository.id),
        eq(userStories.issueNumber, issue.number),
      ),
    );
  if (!found) return;
  const { story, ticket, userId } = found;
  // An imported story (decision 056 D) has no render of Cockpit on GitHub to differ from before its first publication.
  if (story.issueBodyHash === null) return;
  const rendered = renderStory(story, await storyParts(db, story.id));
  // GitHub's web editor sends CRLF line endings; Cockpit's render only has LF.
  const body = (issue.body ?? "").replaceAll("\r\n", "\n");
  if (!rendered || (issue.title === rendered.title && body === rendered.body)) {
    await db
      .update(userStories)
      .set({
        issueGithubTitle: null,
        issueGithubBody: null,
        issueDivergedAt: null,
      })
      .where(eq(userStories.id, story.id));
    return;
  }
  const entry: Entry = {
    userId,
    actor: "github",
    origin: "webhook",
    action: "issue_diverged",
    args: { storyId: story.id, deliveryId: delivery.id },
    projectId: ticket.projectId,
    ticketId: ticket.id,
    storyId: story.id,
  };
  await act(db, entry, async (tx) => {
    await tx
      .update(userStories)
      .set({
        issueGithubTitle: issue.title,
        issueGithubBody: body,
        issueDivergedAt: sql`now()`,
      })
      .where(eq(userStories.id, story.id));
  });
}

const pullNumbers = z.object({
  pull_request: z.object({ number: z.number() }).optional(),
  check_suite: z
    .object({ pull_requests: z.array(z.object({ number: z.number() })) })
    .optional(),
});

/** A delivery that concerns pull requests (decision 038 C): it only says which ones to read again; the story of each is followed as GitHub shows its PR now. A payload without a PR number, or a PR no live story has, is nothing to do. */
async function handlePullRequest(
  db: Db,
  readGitHub: ReturnType<typeof githubReader>,
  delivery: Delivery,
) {
  const parsed = pullNumbers.safeParse(delivery.payload);
  const numbers = parsed.success
    ? [
        ...(parsed.data.pull_request ? [parsed.data.pull_request.number] : []),
        ...(parsed.data.check_suite?.pull_requests.map((p) => p.number) ?? []),
      ]
    : [];
  const project = await projectOfRepo(db, delivery.repoId);
  if (!project) return;
  for (const number of numbers) {
    const [story] = await db
      .select({ id: userStories.id })
      .from(userStories)
      .innerJoin(tickets, eq(tickets.id, userStories.ticketId))
      .where(
        and(
          eq(tickets.projectId, project.id),
          eq(userStories.prNumber, number),
          inArray(userStories.status, ["in_review", "in_progress"]),
        ),
      );
    const found = story && (await memberStory(db, project.userId, story.id));
    if (found)
      await followPullRequest(db, readGitHub, found, project.userId, "webhook");
  }
}

/** What a failed attempt leaves: one more attempt, and at the last one the delivery is given up on, with one entry (decision 025 A; the error itself is only in the log). */
async function fail(db: Db, delivery: Delivery) {
  const project = await projectOfRepo(db, delivery.repoId);
  await db.transaction(async (tx) => {
    const [after] = await tx
      .update(webhookDeliveries)
      .set({ attempts: sql`${webhookDeliveries.attempts} + 1` })
      .where(eq(webhookDeliveries.id, delivery.id))
      .returning({ attempts: webhookDeliveries.attempts });
    if (!after || after.attempts < MAX_ATTEMPTS) return;
    await tx
      .update(webhookDeliveries)
      .set({ processedAt: sql`now()` })
      .where(eq(webhookDeliveries.id, delivery.id));
    await tx.insert(history).values({
      userId: project?.userId ?? null,
      projectId: project?.id ?? null,
      actor: "github",
      origin: "webhook",
      action: "process_webhook",
      args: { deliveryId: delivery.id },
      result: "error",
      detail: { reason: "error" },
    });
  });
}

const claimable = and(
  isNull(webhookDeliveries.processedAt),
  or(
    isNull(webhookDeliveries.claimedAt),
    lt(webhookDeliveries.claimedAt, sql`now() - interval '1 minute'`),
  ),
);

/** One pass over the deliveries not processed yet (decision 025 A): each is reserved by one atomic statement, handled by its event, and dated when done. Never throws. */
export async function processDeliveries(db: Db, deps: Deps) {
  const readGitHub = githubReader(deps.readInstance);
  try {
    for (;;) {
      const [next] = await db
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(claimable)
        .orderBy(asc(webhookDeliveries.receivedAt))
        .limit(1);
      if (!next) return;
      const [delivery] = await db
        .update(webhookDeliveries)
        .set({ claimedAt: sql`now()` })
        .where(and(eq(webhookDeliveries.id, next.id), claimable))
        .returning();
      // Another pass took it first.
      if (!delivery) continue;
      try {
        if (delivery.event === "issues" && delivery.action === "edited")
          await handleIssueEdited(db, deps, delivery);
        else if (PULL_EVENTS.includes(delivery.event))
          await handlePullRequest(db, readGitHub, delivery);
        else if (isAlertEvent(delivery.event))
          await receiveAlert(db, readGitHub, delivery);
        await db
          .update(webhookDeliveries)
          .set({ processedAt: sql`now()` })
          .where(eq(webhookDeliveries.id, delivery.id));
      } catch (error) {
        console.error(`Webhook delivery ${delivery.id} failed:`, error);
        await fail(db, delivery);
      }
    }
  } catch (error) {
    console.error("Processing of the webhook deliveries failed:", error);
  }
}

/** Processes now, then every minute, to take up what failed or was interrupted. */
export function scheduleDeliveries(db: Db, deps: Deps): NodeJS.Timeout {
  const run = () => void processDeliveries(db, deps);
  run();
  return setInterval(run, PROCESS_EVERY_MS).unref();
}

/** Receives GitHub's deliveries: verified on the raw bytes, then recorded with their history entry; the processing starts after the answer (decisions 024 and 025). */
export function webhookRoutes(db: Db, readInstance: ReadInstance) {
  return new Hono().post(
    WEBHOOK_PATH,
    bodyLimit({ maxSize: MAX_BODY }),
    async (c) => {
      const settings = await readInstance();
      if (!settings) return c.json({ error: NOT_CONFIGURED }, 503);

      // A missing or malformed signature is refused before the body is read: a scanner cannot make Cockpit buffer 25 MiB for free.
      const sent = SIGNATURE.exec(
        c.req.header("x-hub-signature-256") ?? "",
      )?.[1];
      if (!sent) {
        console.error("Webhook refused: missing or wrong signature");
        return c.json({ error: "Unauthorized" }, 401);
      }
      // The raw bytes, read once: the signature is over them, not over a re-serialisation.
      const raw = Buffer.from(await c.req.arrayBuffer());
      const expected = createHmac("sha256", settings.githubWebhookSecret)
        .update(raw)
        .digest();
      if (!timingSafeEqual(Buffer.from(sent, "hex"), expected)) {
        console.error("Webhook refused: missing or wrong signature");
        return c.json({ error: "Unauthorized" }, 401);
      }

      const id = c.req.header("x-github-delivery") ?? "";
      const event = c.req.header("x-github-event") ?? "";
      let body: unknown;
      try {
        // jsonb refuses NUL and lone surrogates, which GitHub's text (an issue body) may carry: replaced, so the delivery is still recorded.
        body = JSON.parse(raw.toString("utf8"), (_key, value) =>
          typeof value === "string"
            ? value.replaceAll("\0", "\uFFFD").toWellFormed()
            : value,
        );
      } catch {
        body = null;
      }
      if (
        id.length < 1 ||
        id.length > MAX_DELIVERY_ID ||
        !EVENT.test(event) ||
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body)
      )
        return c.json({ error: "Bad request" }, 400);

      const payload = body as Record<string, unknown>;
      // Decision 052 D: the value of a secret is never written, the delivery included.
      if (
        event === "secret_scanning_alert" &&
        typeof payload.alert === "object" &&
        payload.alert !== null
      )
        delete (payload.alert as Record<string, unknown>).secret;
      const action = typeof payload.action === "string" ? payload.action : null;
      const repoId = idIn(payload.repository);
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(webhookDeliveries)
          .values({
            id,
            event,
            action,
            installationId: idIn(payload.installation),
            repoId,
            payload,
          })
          .onConflictDoNothing()
          .returning({ id: webhookDeliveries.id });
        // Already received: GitHub sent it again, nothing more to write.
        if (inserted.length === 0) return;
        const project = await projectOfRepo(tx, repoId);
        await tx.insert(history).values({
          userId: project?.userId ?? null,
          projectId: project?.id ?? null,
          actor: "github",
          origin: "webhook",
          action: "receive_webhook",
          args: { deliveryId: id, event, action },
          result: "ok",
        });
      });
      // Not awaited: the answer does not wait for the processing, which never throws.
      void processDeliveries(db, { readInstance });
      return c.body(null, 202);
    },
  );
}
