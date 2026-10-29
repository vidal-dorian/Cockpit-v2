// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abandonStory,
  abandonTicket,
  bobsStory,
  type Ctx,
  editBody,
  editStory,
  send,
  sendBack,
  validate,
  withStory,
} from "./test-decisions.ts";
import { issueCalls } from "./test-github.ts";
import {
  archiveProject,
  historyText,
  type Row,
  rows,
  seedStory,
} from "./test-mcp.ts";

// Slice 4.6 (decision 020): the issue of a validated story, kept up to date after each decision.
// GitHub is the fake of test-github.ts, which serves the issue endpoints of the repo user1000/app and keeps the issues.
//
// Pinned shapes (the decision leaves them open):
// - POST /api/stories/:id/publish, no body -> 200 { story }; 401, 404, 409 { error: "project_archived" | "wrong_status" | ... } like the other decisions.
// - `story` (of GET /api/stories/:id and of every decision) carries `issue`:
//   null when the story has no issue and should have none (to_validate, to_rewrite, abandoned and never published);
//   otherwise { number: number | null, url: string | null, upToDate: boolean }, `url` being the html_url of the issue
//   (https://github.com/<owner>/<repo>/issues/<number>), null with the number.
// - user_stories.issue_number (integer), issue_body_hash (hex SHA-256 of the body sent), issue_claimed_at (timestamptz).
// - history.github_effects (jsonb) = { issueNumber, created, closed } on the `sync_issue` entries.
// - A sync that fails (GitHub answers 500) leaves an entry `error` with detail { reason: "error" } and releases its claim.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const publish = (ctx: Ctx, cookie: string, id: number | string) =>
  send(ctx.app, cookie, "POST", `/api/stories/${id}/publish`);

type StoryRow = {
  issue_number: number | null;
  issue_body_hash: string | null;
  issue_claimed_at: Date | null;
};
async function issueRow(ctx: Ctx, id: number) {
  const result = await ctx.db.execute(
    sql`select issue_number, issue_body_hash, issue_claimed_at from user_stories where id = ${id}`,
  );
  return (result as unknown as { rows: StoryRow[] }).rows[0] as StoryRow;
}

type SyncRow = Row & {
  github_effects: {
    issueNumber: number;
    created: boolean;
    closed: boolean;
  } | null;
};
const syncs = (ctx: Ctx) =>
  rows(ctx.db, sql`action = 'sync_issue'`) as Promise<SyncRow[]>;

const issues = (ctx: Ctx) => ctx.fetchMock.issues(REPO);
const theIssue = (ctx: Ctx) => {
  expect(issues(ctx), "exactly one issue on GitHub").toHaveLength(1);
  return issues(ctx)[0] as ReturnType<typeof issues>[number];
};
/** The calls that create an issue. */
const creations = (ctx: Ctx) =>
  issueCalls(ctx.fetchMock).filter(
    (c) => c.method === "POST" && c.path === `/repos/${REPO}/issues`,
  );

type Shown = {
  status: string;
  issue: {
    number: number | null;
    url: string | null;
    upToDate: boolean;
  } | null;
};
async function shown(ctx: Ctx, id: number): Promise<Shown> {
  const res = await send(
    ctx.app,
    ctx.alice.cookie,
    "GET",
    `/api/stories/${id}`,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { story: Shown }).story;
}

/** A to_validate story, validated: its issue is #1 of the repo. */
async function published(over: Parameters<typeof withStory>[1] = {}) {
  const s = await withStory("to_validate", over);
  expect((await validate(s.app, s.alice.cookie, s.id)).status).toBe(200);
  return s;
}

describe("criterion 2: validating a story publishes it", () => {
  it.each(["to_validate", "to_rewrite"] as const)(
    "given a %s story, when it is validated, then one issue is created (title = the je veux, the story in the body, label cockpit: prête, open), the story keeps its issue_number and the SHA-256 of the body sent, the claim is released and the answer says ready",
    async (status) => {
      const s = await withStory(status, {
        rewriteComment: status === "to_rewrite" ? "Précise" : null,
      });

      const res = await validate(s.app, s.alice.cookie, s.id);

      expect(res.status).toBe(200);
      const answer = (await res.json()) as { story: { status: string } };
      expect(answer.story.status).toBe("ready");
      const issue = theIssue(s);
      expect(issue).toMatchObject({
        title: "relire",
        state: "open",
        labels: ["cockpit: prête"],
      });
      expect(issue.body).toContain(`<!-- cockpit:story:${s.id} -->`);
      expect(issue.body).toContain(
        "- [ ] **Étant donné** g1 **quand** w1 **alors** t1",
      );
      expect(s.fetchMock.labels(REPO)).toContain("cockpit: prête");
      expect(creations(s)).toHaveLength(1);
      const row = await issueRow(s, s.id);
      expect(row.issue_number).toBe(issue.number);
      expect(row.issue_body_hash).toBe(sha256(issue.body));
      expect(row.issue_claimed_at).toBeNull();
    },
  );

  it("given the label already exists in the repo, when a story is validated, then the issue is created with it all the same (the « already exists » answer is ignored)", async () => {
    const s = await withStory("to_validate");
    s.fetchMock.addLabel(REPO, "cockpit: prête");

    const res = await validate(s.app, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect(theIssue(s).labels).toEqual(["cockpit: prête"]);
  });

  it("given the dependency of a story already has an issue, when the story is validated, then its issue says « Dépend de # » followed by that number; without an issue, it names the story", async () => {
    const withoutIssue = await withStory("to_validate");
    await validate(
      withoutIssue.app,
      withoutIssue.alice.cookie,
      withoutIssue.id,
    );
    expect(theIssue(withoutIssue).body).toContain(
      `Dépend de US ${withoutIssue.base}`,
    );

    const s = await withStory("to_validate");
    expect((await publish(s, s.alice.cookie, s.base)).status).toBe(200);
    const baseNumber = (await issueRow(s, s.base)).issue_number;
    expect(baseNumber).not.toBeNull();

    await validate(s.app, s.alice.cookie, s.id);

    const own = issues(s).find((i) => i.title === "relire");
    expect(own?.body).toContain(`Dépend de #${baseNumber}`);
  });

  it("given a to_validate story, when it is sent back, edited or left alone, then it has no issue and GitHub is not called", async () => {
    const s = await withStory("to_validate");

    await editStory(s.app, s.alice.cookie, s.id, editBody(1));
    await sendBack(s.app, s.alice.cookie, s.id, { comment: "Précise" });
    await editStory(s.app, s.alice.cookie, s.id, editBody(2));

    expect(issueCalls(s.fetchMock)).toEqual([]);
    expect(issues(s)).toEqual([]);
    expect((await issueRow(s, s.id)).issue_number).toBeNull();
    expect(await syncs(s)).toEqual([]);
    expect((await shown(s, s.id)).issue).toBeNull();
  });
});

describe("criterion 3: editing a ready story updates its issue", () => {
  it("given a published story, when it is edited, then the same issue gets the new title and body, the hash follows, and no second issue is created", async () => {
    const s = await published();
    const before = await issueRow(s, s.id);

    const res = await editStory(s.app, s.alice.cookie, s.id, editBody(1));

    expect(res.status).toBe(200);
    const issue = theIssue(s);
    expect(creations(s)).toHaveLength(1);
    expect(issue.title).toBe("vouloir-modifié-1");
    expect(issue.body).toContain("alors-neuf-1a");
    expect(issue.body).not.toContain("t1");
    expect(issue.labels).toEqual(["cockpit: prête"]);
    expect(issue.state).toBe("open");
    const after = await issueRow(s, s.id);
    expect(after.issue_number).toBe(before.issue_number);
    expect(after.issue_body_hash).toBe(sha256(issue.body));
    expect(after.issue_body_hash).not.toBe(before.issue_body_hash);
    expect((await shown(s, s.id)).issue?.upToDate).toBe(true);
  });
});

describe("criterion 4: abandoning a story closes its issue", () => {
  it("given a published story carrying another label, when it is abandoned, then the issue is closed as not_planned, cockpit: prête gives way to cockpit: abandonnée and the other label stays", async () => {
    const s = await published();
    const number = theIssue(s).number;
    s.fetchMock.addIssueLabel(REPO, number, "bug");

    const res = await abandonStory(s.app, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    const issue = theIssue(s);
    expect(issue).toMatchObject({
      state: "closed",
      stateReason: "not_planned",
    });
    expect([...issue.labels].sort()).toEqual(["bug", "cockpit: abandonnée"]);
    expect(issue.body).toContain("abandonnée");
    expect((await issueRow(s, s.id)).issue_body_hash).toBe(sha256(issue.body));
    expect(creations(s)).toHaveLength(1);
    expect((await shown(s, s.id)).issue).toMatchObject({
      number,
      upToDate: true,
    });
  });

  it.each(["to_validate", "to_rewrite", "ready"] as const)(
    "given a %s story that was never published, when it is abandoned, then GitHub is not called and it has no issue",
    async (status) => {
      const s = await withStory(status);

      const res = await abandonStory(s.app, s.alice.cookie, s.id);

      expect(res.status).toBe(200);
      expect(issueCalls(s.fetchMock)).toEqual([]);
      expect((await issueRow(s, s.id)).issue_number).toBeNull();
      expect((await shown(s, s.id)).issue).toBeNull();
    },
  );
});

describe("criterion 5: abandoning a ticket closes the issues of its published stories", () => {
  it("given a ticket with two published stories and one story never published, when the ticket is abandoned, then both issues are closed as not_planned and nothing is created for the third", async () => {
    const s = await published();
    expect((await publish(s, s.alice.cookie, s.base)).status).toBe(200);
    const third = await seedStory(s.db, s.ticketId, { status: "to_validate" });
    expect(issues(s)).toHaveLength(2);

    const res = await abandonTicket(s.app, s.alice.cookie, s.ticketId);

    expect(res.status).toBe(200);
    expect(issues(s)).toHaveLength(2);
    for (const issue of issues(s)) {
      expect(issue).toMatchObject({
        state: "closed",
        stateReason: "not_planned",
      });
      expect(issue.labels).toEqual(["cockpit: abandonnée"]);
    }
    expect(creations(s)).toHaveLength(2);
    expect((await issueRow(s, third)).issue_number).toBeNull();
    for (const id of [s.id, s.base])
      expect((await shown(s, id)).issue?.upToDate).toBe(true);
    const closing = (await syncs(s)).filter((e) => e.github_effects?.closed);
    expect(closing.map((e) => e.story_id).sort()).toEqual(
      [s.id, s.base].sort(),
    );
  });
});

describe("criterion 6: GitHub is down", () => {
  it("given GitHub answers 500, when a story is validated, then the validation succeeds, no issue number is saved, one error entry is written without any GitHub message, and the story says its issue is not up to date", async () => {
    const s = await withStory("to_validate");
    s.fetchMock.update({ issuesStatus: 500 });

    const res = await validate(s.app, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    const answer = (await res.json()) as { story: { status: string } };
    expect(answer.story.status).toBe("ready");
    const row = await issueRow(s, s.id);
    expect(row.issue_number).toBeNull();
    expect(row.issue_body_hash).toBeNull();
    const entries = await syncs(s);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: s.alice.id,
      story_id: s.id,
      actor: "system",
      origin: "system",
      result: "error",
      detail: { reason: "error" },
    });
    expect(await historyText(s.db)).not.toContain("github-boom-message");
    expect(await shown(s, s.id)).toMatchObject({
      status: "ready",
      issue: { number: null, url: null, upToDate: false },
    });
  });

  it("given the validation could not publish, when the story is published again once GitHub is back, then the issue is created (the failed attempt left no claim) and the story says it is up to date", async () => {
    const s = await withStory("to_validate");
    s.fetchMock.update({ issuesStatus: 500 });
    await validate(s.app, s.alice.cookie, s.id);
    s.fetchMock.update({ issuesStatus: undefined });

    const res = await publish(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    const issue = theIssue(s);
    expect((await issueRow(s, s.id)).issue_number).toBe(issue.number);
    expect(await shown(s, s.id)).toMatchObject({
      issue: {
        number: issue.number,
        url: `https://github.com/${REPO}/issues/${issue.number}`,
        upToDate: true,
      },
    });
    expect((await syncs(s)).map((e) => e.result)).toEqual(["error", "ok"]);
  });

  it("given a published story, when it is edited while GitHub answers 500, then the edit succeeds, the story keeps its issue number and says it is not up to date, and publishing again brings the issue up to date", async () => {
    const s = await published();
    const number = theIssue(s).number;
    s.fetchMock.update({ issuesStatus: 500 });

    const res = await editStory(s.app, s.alice.cookie, s.id, editBody(3));

    expect(res.status).toBe(200);
    expect((await shown(s, s.id)).issue).toMatchObject({
      number,
      upToDate: false,
    });
    expect(theIssue(s).title).toBe("relire");
    s.fetchMock.update({ issuesStatus: undefined });

    expect((await publish(s, s.alice.cookie, s.id)).status).toBe(200);

    expect(theIssue(s).title).toBe("vouloir-modifié-3");
    expect((await shown(s, s.id)).issue?.upToDate).toBe(true);
    expect(creations(s)).toHaveLength(1);
  });
});

describe("criterion 7: the publish route", () => {
  it("given no session, when publish is called, then 401 and GitHub is not called", async () => {
    const s = await withStory("ready");

    const res = await publish(s, "", s.id);

    expect(res.status).toBe(401);
    expect(issueCalls(s.fetchMock)).toEqual([]);
  });

  it("given my own ready story works, when publish is called on another user's story, an unknown id and ids that are no id, then every answer is 404 and GitHub is not called for them", async () => {
    const s = await withStory("ready");
    const bob = await bobsStory(s);
    await s.db.execute(
      sql`update user_stories set status = 'ready' where id = ${bob.storyId}`,
    );
    expect((await publish(s, s.alice.cookie, s.id)).status).toBe(200);
    const callsBefore = issueCalls(s.fetchMock).length;

    for (const id of [String(bob.storyId), "424242", "abc", "0", "-1", "1.5"]) {
      const res = await publish(s, s.alice.cookie, id);
      expect(res.status, `id ${id}`).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("secret-de-Bob");
    }

    expect(issueCalls(s.fetchMock)).toHaveLength(callsBefore);
    expect((await issueRow(s, bob.storyId)).issue_number).toBeNull();
  });

  it("given a ready story of an archived project, when it is published, then 409 project_archived and GitHub is not called", async () => {
    const s = await withStory("ready");
    await archiveProject(s.db, s.projectId);

    const res = await publish(s, s.alice.cookie, s.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(issueCalls(s.fetchMock)).toEqual([]);
    expect((await issueRow(s, s.id)).issue_number).toBeNull();
  });

  it.each(["to_validate", "to_rewrite", "abandoned"] as const)(
    "given a %s story that has no issue and should have none, when it is published, then 409 wrong_status and GitHub is not called",
    async (status) => {
      const s = await withStory(status);

      const res = await publish(s, s.alice.cookie, s.id);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "wrong_status" });
      expect(issueCalls(s.fetchMock)).toEqual([]);
      expect((await issueRow(s, s.id)).issue_number).toBeNull();
    },
  );

  it("given a ready story that never got its issue, when it is published, then 200, the issue is created and the answer shows it up to date", async () => {
    const s = await withStory("ready");

    const res = await publish(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    const issue = theIssue(s);
    const answer = (await res.json()) as { story: Shown };
    expect(answer.story).toMatchObject({
      status: "ready",
      issue: {
        number: issue.number,
        url: `https://github.com/${REPO}/issues/${issue.number}`,
        upToDate: true,
      },
    });
  });

  it("given an issue that is up to date, when the story is published, then 200 and GitHub is not called", async () => {
    const s = await published();
    const calls = issueCalls(s.fetchMock).length;
    const issueBefore = structuredClone(theIssue(s));

    const res = await publish(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect(issueCalls(s.fetchMock)).toHaveLength(calls);
    expect(theIssue(s)).toEqual(issueBefore);
  });
});

describe("criterion 8: the history of the synchronisations", () => {
  it("given a story validated, edited and abandoned, when the history is read, then each sync left one sync_issue entry (system, system, the user of the decision, ids, args { storyId }) with its github_effects, and no text of the story appears anywhere", async () => {
    const s = await withStory("to_validate", {
      asA: "role-ZQX-a",
      iWant: "veux-ZQX-b",
      soThat: "afin-ZQX-c",
      notesMd: "notes-ZQX-d",
      criteria: [{ given: "g-ZQX", when: "w-ZQX", then: "t-ZQX" }],
    });

    await validate(s.app, s.alice.cookie, s.id);
    const number = theIssue(s).number;
    await editStory(s.app, s.alice.cookie, s.id, editBody(4));
    await abandonStory(s.app, s.alice.cookie, s.id);

    const entries = await syncs(s);
    expect(entries.map((e) => e.github_effects)).toEqual([
      { issueNumber: number, created: true, closed: false },
      { issueNumber: number, created: false, closed: false },
      { issueNumber: number, created: false, closed: true },
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        user_id: s.alice.id,
        token_id: null,
        project_id: s.projectId,
        ticket_id: s.ticketId,
        story_id: s.id,
        actor: "system",
        origin: "system",
        action: "sync_issue",
        result: "ok",
        detail: null,
      });
      expect(entry.args).toEqual({ storyId: s.id });
    }
    const text = await historyText(s.db);
    expect(text).not.toContain("ZQX");
    expect(text).not.toContain("modifié");
    expect(text).not.toContain("neuf");
  });
});

describe("criterion 9: two syncs at once", () => {
  it("given a ready story without issue, when two publish calls arrive together while GitHub is slow, then exactly one issue is created, the story keeps its number and the claim is released", async () => {
    const s = await withStory("ready");
    s.fetchMock.update({ issuesDelay: 40 });

    const answers = await Promise.all([
      publish(s, s.alice.cookie, s.id),
      publish(s, s.alice.cookie, s.id),
    ]);

    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(creations(s)).toHaveLength(1);
    const issue = theIssue(s);
    const row = await issueRow(s, s.id);
    expect(row.issue_number).toBe(issue.number);
    expect(row.issue_claimed_at).toBeNull();
  });

  it("given a claim set less than a minute ago, when the story is published, then the sync makes no GitHub call and leaves the claim alone", async () => {
    const s = await withStory("ready");
    await s.db.execute(
      sql`update user_stories set issue_claimed_at = now() - interval '10 seconds' where id = ${s.id}`,
    );

    const res = await publish(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect(issueCalls(s.fetchMock)).toEqual([]);
    const row = await issueRow(s, s.id);
    expect(row.issue_number).toBeNull();
    expect(row.issue_claimed_at).not.toBeNull();
  });

  it("given a claim set more than a minute ago, when the story is published, then the sync goes ahead, creates the issue and releases the claim", async () => {
    const s = await withStory("ready");
    await s.db.execute(
      sql`update user_stories set issue_claimed_at = now() - interval '90 seconds' where id = ${s.id}`,
    );

    const res = await publish(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect(creations(s)).toHaveLength(1);
    const row = await issueRow(s, s.id);
    expect(row.issue_number).toBe(theIssue(s).number);
    expect(row.issue_claimed_at).toBeNull();
  });
});
