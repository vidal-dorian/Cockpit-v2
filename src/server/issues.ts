import { createHash } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { act, type Entry } from "./action.ts";
import type { Db } from "./db/db.ts";
import { history, userStories } from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import { COCKPIT_LABELS, isIssueStatus, renderIssue } from "./issue-render.ts";
import { memberStory, storyParts } from "./stories.ts";

type Story = typeof userStories.$inferSelect;
type Parts = Awaited<ReturnType<typeof storyParts>>;

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** The issue of a story as it should be now, with the hash of its body; null when the story has none and should have none (decision 020 A and D). */
export function renderStory(story: Story, { criteria, dependsOn }: Parts) {
  if (!isIssueStatus(story.status)) return null;
  if (story.status === "abandoned" && story.issueNumber === null) return null;
  const rendered = renderIssue({
    ...story,
    status: story.status,
    criteria: criteria.map((k) => ({
      given: k.givenText,
      when: k.whenText,
      // biome-ignore lint/suspicious/noThenProperty: "then" is the Given/When/Then field of the API (decision 017)
      then: k.thenText,
    })),
    dependsOn,
  });
  return { ...rendered, hash: sha256(rendered.body) };
}

/** Whether the story has an issue or should have one: what `POST /publish` accepts. */
export const shouldHaveIssue = (story: Story) =>
  isIssueStatus(story.status) &&
  (story.status !== "abandoned" || story.issueNumber !== null);

/** What the API says of the issue of a story (decision 020 J); `upToDate` is computed by rendering the story again, `diverged` (decision 025 E) sets GitHub's version against the render. */
export function issueOf(story: Story, parts: Parts, fullName: string) {
  const rendered = renderStory(story, parts);
  if (!rendered) return null;
  return {
    diverged:
      story.issueDivergedAt === null
        ? null
        : {
            at: story.issueDivergedAt,
            githubTitle: story.issueGithubTitle ?? "",
            githubBody: story.issueGithubBody ?? "",
            cockpitTitle: rendered.title,
            cockpitBody: rendered.body,
          },
    number: story.issueNumber,
    url:
      story.issueNumber === null
        ? null
        : `https://github.com/${fullName}/issues/${story.issueNumber}`,
    upToDate: rendered.hash === story.issueBodyHash,
  };
}

/** Reserves the creation of the issue (decision 020 G): one statement, so only one of two callers at once gets true. A claim older than a minute is a creation that died. */
async function claim(db: Db, storyId: number) {
  const claimed = await db
    .update(userStories)
    .set({ issueClaimedAt: sql`now()` })
    .where(
      and(
        eq(userStories.id, storyId),
        isNull(userStories.issueNumber),
        or(
          isNull(userStories.issueClaimedAt),
          lt(userStories.issueClaimedAt, sql`now() - interval '1 minute'`),
        ),
      ),
    )
    .returning({ id: userStories.id });
  return claimed.length > 0;
}

async function sync(
  db: Db,
  readGitHub: ReadGitHub,
  userId: number,
  storyId: number,
) {
  const found = await memberStory(db, userId, storyId);
  if (!found) return;
  const { story, ticket, project } = found;
  // Someone edited the issue on GitHub: nothing is written there until the user chooses (decision 025 D).
  if (story.issueDivergedAt) return;
  const rendered = renderStory(story, await storyParts(db, story.id));
  if (!rendered || rendered.hash === story.issueBodyHash) return;
  const created = story.issueNumber === null;
  if (created && !(await claim(db, story.id))) return;

  const entry: Entry = {
    userId,
    actor: "system",
    origin: "system",
    action: "sync_issue",
    args: { storyId: story.id },
    projectId: project.id,
    ticketId: ticket.id,
    storyId: story.id,
  };
  let number = story.issueNumber;
  let closed = false;
  try {
    const ready = await readGitHub();
    if (!ready) throw new Error("The GitHub App is not configured");
    const issues = await ready.github.issues(
      project.installationId,
      project.fullName,
    );
    let labels: string[] = [];
    if (number === null) {
      ({ number, labels } = await issues.create(rendered));
      // Saved at once and alone: whatever fails next, the next sync updates this issue instead of creating another.
      await db
        .update(userStories)
        .set({ issueNumber: number })
        .where(eq(userStories.id, story.id));
    }
    const n = number;
    // A new issue is open: only a story published late (done, abandoned) must be closed at once.
    if (!created || rendered.state === "closed") {
      labels = await issues.update(n, rendered);
      closed = rendered.state === "closed";
    }
    // Only a missing label is added, and only the other Cockpit labels the issue carries are removed (decision 020 C).
    if (!labels.includes(rendered.label))
      labels = await issues.addLabel(n, rendered.label);
    await Promise.all(
      COCKPIT_LABELS.filter(
        (name) => name !== rendered.label && labels.includes(name),
      ).map((name) => issues.removeLabel(n, name)),
    );
  } catch (error) {
    // The history only gets a closed value (decision 010 D), the log the rest.
    console.error(`Action ${entry.action} failed:`, error);
    if (created)
      await db
        .update(userStories)
        .set({ issueClaimedAt: null })
        .where(eq(userStories.id, story.id));
    await db.insert(history).values({
      ...entry,
      result: "error",
      detail: { reason: "error" },
      ...(created &&
        number !== null && {
          githubEffects: { issueNumber: number, created, closed },
        }),
    });
    return;
  }
  const saved = number;
  await act(db, entry, async (tx) => {
    entry.githubEffects = { issueNumber: saved, created, closed };
    await tx
      .update(userStories)
      .set({
        issueNumber: saved,
        issueBodyHash: rendered.hash,
        issueClaimedAt: null,
      })
      .where(eq(userStories.id, story.id));
  });
}

/** Brings the issue of a story up to date on GitHub (decision 020 F): to be called once the decision is committed, never inside its transaction. Never throws; a failure is in the history and the page says the issue is not up to date. */
export async function syncIssue(
  db: Db,
  readGitHub: ReadGitHub,
  userId: number,
  storyId: number,
) {
  try {
    await sync(db, readGitHub, userId, storyId);
  } catch (error) {
    console.error(`Issue sync of story ${storyId} failed:`, error);
  }
}

/** The stories of an abandoned ticket that have an issue, one after the other; once `budgetMs` is spent no new sync starts and the rest stay not up to date (decision 020 F). */
export async function syncTicketIssues(
  db: Db,
  readGitHub: ReadGitHub,
  userId: number,
  ticketId: number,
  budgetMs: number,
) {
  const deadline = Date.now() + budgetMs;
  const published = await db
    .select({ id: userStories.id })
    .from(userStories)
    .where(
      and(
        eq(userStories.ticketId, ticketId),
        isNotNull(userStories.issueNumber),
      ),
    )
    .orderBy(asc(userStories.position), asc(userStories.id));
  for (const { id } of published) {
    if (Date.now() >= deadline) return;
    await syncIssue(db, readGitHub, userId, id);
  }
}
