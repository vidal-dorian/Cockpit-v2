// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abandonStory,
  abandonTicket,
  editBody,
  editStory,
  send,
  snapshot,
  storyHistory,
} from "./test-decisions.ts";
import { issueCalls } from "./test-github.ts";
import {
  BOT,
  diverge,
  divergenceOf,
  editOnGitHub,
  entriesOf,
  NOT_DIVERGED,
  publishedStory,
  REPO,
  REPO_ID,
} from "./test-issue-edit.ts";
import { historyText, seedProject, seedStory, seedTicket } from "./test-mcp.ts";

// Decision 025 B, C, D (slice 5.2): an issue edited on GitHub makes the story diverge, and the sync stops writing meanwhile.
// The pinned shapes (tables, columns, entries, API fields) are listed at the top of test-issue-edit.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Shown = {
  status: string;
  issue: {
    number: number | null;
    upToDate: boolean;
    diverged: {
      at: string;
      githubTitle: string;
      githubBody: string;
      cockpitTitle: string;
      cockpitBody: string;
    } | null;
  } | null;
};
async function shown(
  s: { app: Parameters<typeof send>[0]; alice: { cookie: string } },
  id: number,
) {
  const res = await send(s.app, s.alice.cookie, "GET", `/api/stories/${id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { story: Shown }).story;
}

describe("criterion B and C: an issues.edited delivery that differs from the render", () => {
  it.each([
    ["the title", { title: "Un autre titre", body: undefined }],
    [
      "the body",
      { title: undefined, body: "Un autre corps\n\navec deux lignes" },
    ],
    ["the title and the body", { title: "Titre B", body: "Corps B" }],
  ])(
    "given someone changed %s on GitHub, when the delivery is processed, then the story keeps GitHub's title and body and the date, and one issue_diverged entry names the story and the delivery, never the text",
    async (_name, edit) => {
      const s = await publishedStory();
      const sent = await diverge(s, {
        ...edit,
        body: edit.body ?? s.github.body,
      });

      const row = await divergenceOf(s.db, s.id);
      expect(row.issue_github_title).toBe(edit.title ?? s.github.title);
      expect(row.issue_github_body).toBe(sent.body);
      expect(row.issue_diverged_at).not.toBeNull();
      expect(
        Math.abs(
          Date.now() - new Date(row.issue_diverged_at as Date).getTime(),
        ),
      ).toBeLessThan(60_000);
      const entries = await entriesOf(s.db, "issue_diverged");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        user_id: s.alice.id,
        token_id: null,
        project_id: s.projectId,
        ticket_id: s.ticketId,
        story_id: s.id,
        actor: "github",
        origin: "webhook",
        action: "issue_diverged",
        result: "ok",
        detail: null,
      });
      expect(entries[0]?.args).toEqual({
        storyId: s.id,
        deliveryId: sent.deliveryId,
      });
      const text = await historyText(s.db);
      expect(text).not.toContain("Un autre");
      expect(text).not.toContain("Corps B");
      expect(text).not.toContain("Ajout humain");
    },
  );

  it("given the body was emptied on GitHub (GitHub sends null), when the delivery is processed, then the story diverges with an empty body", async () => {
    const s = await publishedStory();

    await diverge(s, { body: null });

    expect(await divergenceOf(s.db, s.id)).toMatchObject({
      issue_github_title: s.github.title,
      issue_github_body: "",
    });
    expect((await divergenceOf(s.db, s.id)).issue_diverged_at).not.toBeNull();
  });

  it("given an edit made by another bot than the App of Cockpit, when the delivery is processed, then it counts as a human edit", async () => {
    const s = await publishedStory();

    await diverge(s, { login: "some-other-app[bot]" });

    expect((await divergenceOf(s.db, s.id)).issue_diverged_at).not.toBeNull();
  });

  it.each([
    ["made by the App itself", { login: BOT }],
    ["of another action: opened", { action: "opened" }],
    ["of another action: closed", { action: "closed" }],
    ["of another action: reopened", { action: "reopened" }],
    ["of another action: labeled", { action: "labeled" }],
    ["of another action: deleted", { action: "deleted" }],
    ["of a repo nobody tracks", { repoId: 999 }],
    ["of an issue number no story has", { number: 99 }],
  ])(
    "given an edit %s with a body that differs, when the delivery is processed, then nothing is stored on the story and no issue_diverged entry is written",
    async (_name, over) => {
      const s = await publishedStory();

      await editOnGitHub(s.db, {
        number: s.number,
        title: s.github.title,
        body: "Un corps tout autre",
        ...over,
      });

      expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
      expect(await entriesOf(s.db, "issue_diverged")).toEqual([]);
    },
  );

  it("given an issue number that a story of another project has, when an edit of this number arrives for the first project, then neither story diverges", async () => {
    const s = await publishedStory();
    const second = await seedProject(s.db, s.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });
    const ticket = await seedTicket(s.db, second, "Autre ticket");
    const other = await seedStory(s.db, ticket, { status: "ready" });
    await s.db.execute(
      sql`update user_stories set issue_number = 7 where id = ${other}`,
    );

    await editOnGitHub(s.db, {
      number: 7,
      repoId: REPO_ID,
      title: "x",
      body: "Un corps tout autre",
    });

    expect(await divergenceOf(s.db, other)).toMatchObject(NOT_DIVERGED);
    expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
    expect(await entriesOf(s.db, "issue_diverged")).toEqual([]);
  });

  it("given an edit whose title and body equal the render, when the delivery is processed, then nothing is stored and no entry is written", async () => {
    const s = await publishedStory();

    await editOnGitHub(s.db, {
      number: s.number,
      title: s.github.title,
      body: s.github.body,
    });

    expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
    expect(await entriesOf(s.db, "issue_diverged")).toEqual([]);
  });

  it("given GitHub's web editor sent the body with CRLF line endings, when the delivery is processed, then an unchanged body is no divergence and a changed one is kept with LF", async () => {
    const s = await publishedStory();
    const crlf = (text: string) => text.replaceAll("\n", "\r\n");

    await editOnGitHub(s.db, {
      number: s.number,
      title: s.github.title,
      body: crlf(s.github.body),
    });
    expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);

    await editOnGitHub(s.db, {
      number: s.number,
      title: s.github.title,
      body: crlf(`${s.github.body}\n\nAjout humain`),
    });
    expect((await divergenceOf(s.db, s.id)).issue_github_body).toBe(
      `${s.github.body}\n\nAjout humain`,
    );
  });

  it("given a diverged story, when a second edit arrives, then the kept version is replaced and a second entry is written", async () => {
    const s = await publishedStory();
    await diverge(s, { title: "Premier titre", body: "Premier corps" });

    await diverge(s, { title: "Second titre", body: "Second corps" });

    expect(await divergenceOf(s.db, s.id)).toMatchObject({
      issue_github_title: "Second titre",
      issue_github_body: "Second corps",
    });
    expect(await entriesOf(s.db, "issue_diverged")).toHaveLength(2);
  });

  it("given a diverged story, when an edit equal to the render arrives, then the divergence is cleared and no new issue_diverged entry is written", async () => {
    const s = await publishedStory();
    await diverge(s, { title: "Premier titre", body: "Premier corps" });
    expect(await entriesOf(s.db, "issue_diverged")).toHaveLength(1);

    await editOnGitHub(s.db, {
      number: s.number,
      title: s.github.title,
      body: s.github.body,
    });

    expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
    expect(await entriesOf(s.db, "issue_diverged")).toHaveLength(1);
  });

  it("given the story was edited in Cockpit after the sync, when an edit equal to the new render arrives, then it does not diverge: the render is the current one", async () => {
    const s = await publishedStory();
    expect(
      (await editStory(s.app, s.alice.cookie, s.id, editBody(1))).status,
    ).toBe(200);
    const now = s.fetchMock.issues(REPO)[0];

    await editOnGitHub(s.db, {
      number: s.number,
      title: now?.title ?? "",
      body: now?.body ?? "",
    });

    expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
  });
});

describe("criterion D: while the story diverges, the sync does not write on GitHub", () => {
  /** A diverged story and the number of issue calls so far. */
  async function divergedStory() {
    const s = await publishedStory();
    const sent = await diverge(s, {
      title: "Titre humain",
      body: "Corps humain",
    });
    return { s, sent, calls: issueCalls(s.fetchMock).length };
  }
  const noNewCalls = (
    s: Awaited<ReturnType<typeof publishedStory>>,
    calls: number,
  ) => expect(issueCalls(s.fetchMock).slice(calls)).toEqual([]);

  it("given a diverged ready story, when it is edited in Cockpit, then the edit is saved, GitHub's issue endpoints are not called and the story stays diverged with GitHub's version", async () => {
    const { s, calls } = await divergedStory();

    const res = await editStory(s.app, s.alice.cookie, s.id, editBody(1));

    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).asA).toBe("rôle-modifié-1");
    noNewCalls(s, calls);
    expect(await divergenceOf(s.db, s.id)).toMatchObject({
      issue_github_title: "Titre humain",
      issue_github_body: "Corps humain",
    });
    expect((await divergenceOf(s.db, s.id)).issue_diverged_at).not.toBeNull();
    expect((await shown(s, s.id)).issue?.diverged).not.toBeNull();
    expect(
      await entriesOf(s.db, "sync_issue").then((e) =>
        e.filter((x) => x.result === "error"),
      ),
    ).toEqual([]);
  });

  it("given a diverged story, when it is abandoned in Cockpit, then it is abandoned, GitHub's issue endpoints are not called and the story stays diverged", async () => {
    const { s, calls } = await divergedStory();

    const res = await abandonStory(s.app, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).status).toBe("abandoned");
    noNewCalls(s, calls);
    expect((await divergenceOf(s.db, s.id)).issue_diverged_at).not.toBeNull();
    expect(s.github.state).toBe("open");
  });

  it("given a diverged story, when its ticket is abandoned, then the story is abandoned, GitHub's issue endpoints are not called and the story stays diverged", async () => {
    const { s, calls } = await divergedStory();

    const res = await abandonTicket(s.app, s.alice.cookie, s.ticketId);

    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).status).toBe("abandoned");
    noNewCalls(s, calls);
    expect((await divergenceOf(s.db, s.id)).issue_diverged_at).not.toBeNull();
  });

  it("given a diverged story, when Republier is called, then the answer is 200, GitHub's issue endpoints are not called and the story stays diverged", async () => {
    const { s, calls } = await divergedStory();
    await editStory(s.app, s.alice.cookie, s.id, editBody(2));

    const res = await send(
      s.app,
      s.alice.cookie,
      "POST",
      `/api/stories/${s.id}/publish`,
    );

    expect(res.status).toBe(200);
    noNewCalls(s, calls);
    expect((await divergenceOf(s.db, s.id)).issue_diverged_at).not.toBeNull();
  });

  it("given a story that does not diverge, when it is edited, then the issue is written as before (control)", async () => {
    const s = await publishedStory();
    const calls = issueCalls(s.fetchMock).length;

    await editStory(s.app, s.alice.cookie, s.id, editBody(1));

    expect(issueCalls(s.fetchMock).length).toBeGreaterThan(calls);
  });
});

describe("criterion D and E: the page of the story shows the divergence", () => {
  it("given a story that does not diverge, when it is read, then issue.diverged is null", async () => {
    const s = await publishedStory();

    expect((await shown(s, s.id)).issue).toMatchObject({ diverged: null });
  });

  it("given a diverged story, when it is read, then issue.diverged holds the date, GitHub's version and Cockpit's current render", async () => {
    const s = await publishedStory();
    const sent = await diverge(s, {
      title: "Titre humain",
      body: "Corps humain",
    });

    const { issue } = await shown(s, s.id);

    expect(issue?.diverged).toEqual({
      at: expect.any(String),
      githubTitle: "Titre humain",
      githubBody: "Corps humain",
      cockpitTitle: sent.before.title,
      cockpitBody: sent.before.body,
    });
    const row = await divergenceOf(s.db, s.id);
    expect(new Date(issue?.diverged?.at ?? "").getTime()).toBe(
      new Date(row.issue_diverged_at as Date).getTime(),
    );
  });

  it("given a diverged story edited in Cockpit, when it is read, then Cockpit's side follows the edit and GitHub's side stays", async () => {
    const s = await publishedStory();
    await diverge(s, { title: "Titre humain", body: "Corps humain" });
    await editStory(s.app, s.alice.cookie, s.id, editBody(1));

    const { issue } = await shown(s, s.id);

    expect(issue?.diverged?.cockpitTitle).toBe("vouloir-modifié-1");
    expect(issue?.diverged?.cockpitBody).toContain("alors-neuf-1a");
    expect(issue?.diverged?.githubBody).toBe("Corps humain");
  });

  it("given a diverged story, when its ticket's stories and the history of the story are read, then the history shows the issue_diverged entry done by github", async () => {
    const s = await publishedStory();
    await diverge(s, {});

    const res = await storyHistory(s.app, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as {
      entries: { action: string; actor: string; result: string }[];
    };
    expect(entries).toContainEqual(
      expect.objectContaining({
        action: "issue_diverged",
        actor: "github",
        result: "ok",
      }),
    );
  });
});

describe("criterion J: the Kanban card says it", () => {
  it("given a diverged story and one that is not, when the stories of the project are read, then only the first card has issueDiverged true", async () => {
    const s = await publishedStory();
    await diverge(s, {});

    const res = await send(
      s.app,
      s.alice.cookie,
      "GET",
      `/api/projects/${s.projectId}/stories`,
    );

    expect(res.status).toBe(200);
    const { stories } = (await res.json()) as {
      stories: { id: number; issueDiverged: boolean }[];
    };
    expect(stories.map((c) => [c.id, c.issueDiverged]).sort()).toEqual(
      [
        [s.id, true],
        [s.base, false],
      ].sort(),
    );
  });
});
