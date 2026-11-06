// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { abandonTicket, bobsStory, send, snapshot } from "./test-decisions.ts";
import { issueCalls } from "./test-github.ts";
import { testAppOptions } from "./test-instance.ts";
import {
  diverge,
  divergenceOf,
  entriesOf,
  keepCockpit,
  NOT_DIVERGED,
  type Published,
  publishedStory,
  REPO,
  setStatus,
  takeGitHub,
} from "./test-issue-edit.ts";
import { archiveProject, historyText, type StoryStatus } from "./test-mcp.ts";

// Decision 025 F, G, H (slice 5.2): « Garder la version de Cockpit » and « Reprendre la version de GitHub ».
// Pinned (the decision leaves them open), on top of the list at the top of test-issue-edit.ts:
// - POST /api/stories/:id/issue/keep-cockpit and POST /api/stories/:id/issue/take-github, no body, answer 200 { story } (the story of
//   GET /api/stories/:id, with `issue.diverged` now null) or { error: <code> } with 401, 404, 409 like the other decisions.
//   The 409 codes are project_archived, no_divergence, wrong_status (take-github only) and not_template (take-github only).
//   The French message of not_template is the page's (api.ts maps the code), the body of the answer is { error: "not_template" }.
// - Entries keep_cockpit_issue and take_github_issue: human, ui, args { storyId }, the ids of the story filled; a refusal leaves
//   one `refused` entry of the same action with detail { reason: <the code> }, a 401 or a 404 leaves none.
// - A story whose texts do not fit the limits of decision 018 C once read back (a part over 1,000 characters, a criterion over
//   2,000, more than 20 criteria, an empty part) is refused as not_template too: the version of GitHub "does not read back".
// - Taking GitHub's version replaces the narrative, the notes (a body without « ## Notes » empties them) and the criteria; the
//   dependencies and the status stay. GitHub's title is not taken. The issue is then rewritten from the story.
// - Both routes republish with a write that does not depend on the stored hash: GitHub holds someone else's text.
// - When GitHub is down, both routes still clear the divergence (the sync never fails a decision): the issue is then not up to date.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Answer = {
  story: {
    status: string;
    issue: { upToDate: boolean; diverged: unknown } | null;
  };
};

const patches = (s: Published) =>
  issueCalls(s.fetchMock).filter(
    (c) =>
      c.method === "PATCH" && c.path === `/repos/${REPO}/issues/${s.number}`,
  );

/** The texts of a snapshot, without the ids of the criteria (taking GitHub's version rewrites them). */
const plain = (x: Awaited<ReturnType<typeof snapshot>>) => ({
  ...x,
  criteria: x.criteria.map(({ id: _id, ...rest }) => rest),
});

/** Someone rewrote the body on GitHub: the render of Cockpit, changed by `change`. */
const editedByHand = (
  s: Published,
  change: (body: string) => string,
  title = "Titre libre de GitHub",
) => diverge(s, { title, body: change(s.github.body) });

async function expectRefusedEntry(
  s: Published,
  action: string,
  reason: string,
) {
  const entries = await entriesOf(s.db, action);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    user_id: s.alice.id,
    token_id: null,
    project_id: s.projectId,
    ticket_id: s.ticketId,
    story_id: s.id,
    actor: "human",
    origin: "ui",
    action,
    args: { storyId: s.id },
    result: "refused",
    detail: { reason },
  });
}

describe("criterion F: keep the version of Cockpit", () => {
  it("given a diverged story, when Cockpit's version is kept, then 200, the divergence is cleared, the issue gets Cockpit's render back (a PATCH) and the story says it is up to date", async () => {
    const s = await publishedStory();
    const sent = await editedByHand(s, (b) => `${b}\n\nUne ligne de trop`);
    const calls = patches(s).length;

    const res = await keepCockpit(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    const { story } = (await res.json()) as Answer;
    expect(story.issue).toMatchObject({ upToDate: true, diverged: null });
    expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
    expect(patches(s).length).toBeGreaterThan(calls);
    expect(s.github.body).toBe(sent.before.body);
    expect(s.github.title).toBe(sent.before.title);
  });

  it("given a diverged story, when Cockpit's version is kept, then one keep_cockpit_issue entry (human, ui, args { storyId }) is written, never the text", async () => {
    const s = await publishedStory();
    await editedByHand(s, (b) => `${b}\n\nUne ligne de trop ZQX`);

    await keepCockpit(s, s.alice.cookie, s.id);

    const entries = await entriesOf(s.db, "keep_cockpit_issue");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: s.alice.id,
      token_id: null,
      project_id: s.projectId,
      ticket_id: s.ticketId,
      story_id: s.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      detail: null,
    });
    expect(entries[0]?.args).toEqual({ storyId: s.id });
    expect(await historyText(s.db)).not.toContain("ZQX");
  });

  it.each([
    ["ready", "open"],
    ["in_progress", "open"],
    ["in_review", "open"],
    ["done", "closed"],
    ["abandoned", "closed"],
  ] as [StoryStatus, string][])(
    "given a diverged %s story, when Cockpit's version is kept, then 200 and the issue is %s with Cockpit's render: any status is allowed",
    async (status, state) => {
      const s = await publishedStory();
      await setStatus(s.db, s.id, status);
      await editedByHand(s, (b) => `${b}\n\nUne ligne de trop`);

      const res = await keepCockpit(s, s.alice.cookie, s.id);

      expect(res.status).toBe(200);
      expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
      expect(s.github.state).toBe(state);
      expect(s.github.body).not.toContain("Une ligne de trop");
      expect(((await res.json()) as Answer).story.issue?.upToDate).toBe(true);
    },
  );

  it("given GitHub answers 500, when Cockpit's version is kept, then 200, the divergence is cleared and the story says its issue is not up to date; once GitHub is back, Republier brings it up to date", async () => {
    const s = await publishedStory();
    const sent = await editedByHand(s, (b) => `${b}\n\nUne ligne de trop`);
    s.fetchMock.update({ issuesStatus: 500 });

    const res = await keepCockpit(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
    expect(((await res.json()) as Answer).story.issue?.upToDate).toBe(false);
    s.fetchMock.update({ issuesStatus: undefined });

    const again = await send(
      s.app,
      s.alice.cookie,
      "POST",
      `/api/stories/${s.id}/publish`,
    );

    expect(again.status).toBe(200);
    expect(((await again.json()) as Answer).story.issue?.upToDate).toBe(true);
    expect(s.github.body).toBe(sent.before.body);
  });
});

describe("criterion G: take the version of GitHub", () => {
  it("given the narrative was rewritten on GitHub, when GitHub's version is taken, then 200, the story has the new narrative, its criteria, notes, status and dependency are kept, the divergence is cleared and the issue is rewritten from the story", async () => {
    const s = await publishedStory();
    const before = await snapshot(s.db, s.id);
    await editedByHand(s, (b) =>
      b.replace(
        /^En tant que .*$/m,
        "En tant que cheffe de projet, je veux voir l'avancement, afin de décider vite.",
      ),
    );

    const res = await takeGitHub(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect(plain(await snapshot(s.db, s.id))).toEqual({
      ...plain(before),
      asA: "cheffe de projet",
      iWant: "voir l'avancement",
      soThat: "décider vite",
    });
    const { story } = (await res.json()) as Answer;
    expect(story).toMatchObject({ status: "ready" });
    expect(story.issue).toMatchObject({ upToDate: true, diverged: null });
    expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
    // GitHub's title is not taken: the title of the issue is the new « je veux ».
    expect(s.github.title).toBe("voir l'avancement");
    expect(s.github.body).toContain(
      "En tant que cheffe de projet, je veux voir l'avancement, afin de décider vite.",
    );
    expect(JSON.stringify(await snapshot(s.db, s.id))).not.toContain(
      "Titre libre",
    );
  });

  it("given a criterion was reworded and one was added on GitHub, when GitHub's version is taken, then the story has the three criteria in order", async () => {
    const s = await publishedStory();
    await editedByHand(s, (b) =>
      b
        .replace("**alors** t2", "**alors** t2-modifié")
        .replace(
          /(- \[ \] \*\*Étant donné\*\* g2[^\n]*)/,
          "$1\n- [ ] **Étant donné** g3 **quand** w3 **alors** t3",
        ),
    );

    const res = await takeGitHub(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    const after = await snapshot(s.db, s.id);
    expect(
      after.criteria.map((c) => [c.position, c.given, c.when, c.then]),
    ).toEqual([
      [1, "g1", "w1", "t1"],
      [2, "g2", "w2", "t2-modifié"],
      [3, "g3", "w3", "t3"],
    ]);
    expect(after.dependsOn).toHaveLength(1);
    expect(s.github.body).toContain("**alors** t3");
  });

  it("given the notes were rewritten on GitHub, when GitHub's version is taken, then the notes are the new ones", async () => {
    const s = await publishedStory();
    await editedByHand(s, (b) =>
      b.replace("des notes", "De nouvelles notes\n\nsur deux paragraphes"),
    );

    const res = await takeGitHub(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).notesMd).toBe(
      "De nouvelles notes\n\nsur deux paragraphes",
    );
  });

  it("given the notes section was deleted on GitHub, when GitHub's version is taken, then the notes are empty", async () => {
    const s = await publishedStory();
    await editedByHand(s, (b) => b.replace(/## Notes\n\ndes notes\n\n/, ""));

    const res = await takeGitHub(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).notesMd).toBe("");
  });

  it("given notes with a mention and a comment opener and a narrative edited on GitHub, when GitHub's version is taken, then the notes come back exactly as typed (the zero-width space and the escape are undone)", async () => {
    const s = await publishedStory({ notesMd: "ping @bob et <!-- x --> fin" });
    await editedByHand(s, (b) =>
      b.replace(/^En tant que .*$/m, "En tant que a, je veux b, afin de c."),
    );

    const res = await takeGitHub(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).notesMd).toBe(
      "ping @bob et <!-- x --> fin",
    );
  });

  it("given a diverged story, when GitHub's version is taken, then one take_github_issue entry (human, ui, args { storyId }) is written, never the text", async () => {
    const s = await publishedStory();
    await editedByHand(s, (b) => b.replace("**alors** t2", "**alors** t2-ZQX"));

    await takeGitHub(s, s.alice.cookie, s.id);

    const entries = await entriesOf(s.db, "take_github_issue");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      user_id: s.alice.id,
      token_id: null,
      project_id: s.projectId,
      ticket_id: s.ticketId,
      story_id: s.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      detail: null,
    });
    expect(entries[0]?.args).toEqual({ storyId: s.id });
    expect(await historyText(s.db)).not.toContain("ZQX");
  });

  const long = (n: number) => "x".repeat(n);
  it.each([
    [
      "the narrative sentence is missing",
      (b: string) => b.replace(/^En tant que .*\n\n/m, ""),
    ],
    [
      "a criterion line is broken",
      (b: string) => b.replace("**alors** t2", "**donc** t2"),
    ],
    [
      "the body was cut by Cockpit (« (tronqué »)",
      (b: string) =>
        b.replace(
          "\n\nGéré par Cockpit",
          "\n\n(tronqué : la version complète est dans Cockpit)\n\nGéré par Cockpit",
        ),
    ],
    [
      "the criteria section is gone",
      (b: string) =>
        b.replace(/## Critères d'acceptation\n\n(- [^\n]*\n?)+/, ""),
    ],
    [
      "a part of the narrative is over 1,000 characters",
      (b: string) => b.replace("corriger", long(1_001)),
    ],
    [
      "a criterion is over 2,000 characters",
      (b: string) => b.replace("**alors** t2", `**alors** ${long(2_001)}`),
    ],
    [
      "there are 21 criteria",
      (b: string) =>
        b.replace(
          /(- \[ \] \*\*Étant donné\*\* g2[^\n]*)/,
          `$1\n${Array.from({ length: 19 }, (_, i) => `- [ ] **Étant donné** a${i} **quand** b${i} **alors** c${i}`).join("\n")}`,
        ),
    ],
  ])(
    "given %s, when GitHub's version is taken, then 409 not_template, nothing of the story changes, the story stays diverged, GitHub is not written and one refused entry is left",
    async (_name, change) => {
      const s = await publishedStory();
      await editedByHand(s, change);
      const before = await snapshot(s.db, s.id);
      const kept = await divergenceOf(s.db, s.id);
      const calls = issueCalls(s.fetchMock).length;

      const res = await takeGitHub(s, s.alice.cookie, s.id);

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "not_template" });
      expect(await snapshot(s.db, s.id)).toEqual(before);
      expect(await divergenceOf(s.db, s.id)).toEqual(kept);
      expect(issueCalls(s.fetchMock)).toHaveLength(calls);
      await expectRefusedEntry(s, "take_github_issue", "not_template");
    },
  );
});

describe.each([
  {
    name: "keep-cockpit",
    action: "keep_cockpit_issue",
    call: keepCockpit,
    path: "/api/stories/1/issue/keep-cockpit",
  },
  {
    name: "take-github",
    action: "take_github_issue",
    call: takeGitHub,
    path: "/api/stories/1/issue/take-github",
  },
])("criterion H: the barriers of $name", ({ action, call, path }) => {
  it("given an instance the wizard has not configured, when it is called, then 503", async () => {
    const app = createApp(await openTestDatabase(), "1.2.3", testAppOptions);

    const res = await app.request(path, { method: "POST" });

    expect(res.status).toBe(503);
  });

  it("given no session, when it is called, then 401, the story stays diverged and nothing is written", async () => {
    const s = await publishedStory();
    await diverge(s, {});
    const kept = await divergenceOf(s.db, s.id);
    const calls = issueCalls(s.fetchMock).length;

    const res = await call(s, "", s.id);

    expect(res.status).toBe(401);
    expect(await divergenceOf(s.db, s.id)).toEqual(kept);
    expect(issueCalls(s.fetchMock)).toHaveLength(calls);
    expect(await entriesOf(s.db, action)).toEqual([]);
  });

  it("given my own diverged story, when it is called on another user's story, an unknown id and ids that are no id, then every answer is 404, nothing leaks and no entry is written", async () => {
    const s = await publishedStory();
    const bob = await bobsStory(s);
    await diverge(s, {});
    const calls = issueCalls(s.fetchMock).length;

    for (const id of [String(bob.storyId), "424242", "abc", "0", "-1", "1.5"]) {
      const res = await call(s, s.alice.cookie, id);
      expect(res.status, `id ${id}`).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("secret-de-Bob");
    }

    expect(issueCalls(s.fetchMock)).toHaveLength(calls);
    expect(await entriesOf(s.db, action)).toEqual([]);
  });

  it("given a diverged story of an archived project, when it is called, then 409 project_archived, the story stays diverged, GitHub is not written and a refused entry is left", async () => {
    const s = await publishedStory();
    await diverge(s, {});
    await archiveProject(s.db, s.projectId);
    const before = await snapshot(s.db, s.id);
    const kept = await divergenceOf(s.db, s.id);
    const calls = issueCalls(s.fetchMock).length;

    const res = await call(s, s.alice.cookie, s.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "project_archived" });
    expect(await snapshot(s.db, s.id)).toEqual(before);
    expect(await divergenceOf(s.db, s.id)).toEqual(kept);
    expect(issueCalls(s.fetchMock)).toHaveLength(calls);
    await expectRefusedEntry(s, action, "project_archived");
  });

  it("given a story that does not diverge, when it is called, then 409 no_divergence, nothing changes, GitHub is not written and a refused entry is left", async () => {
    const s = await publishedStory();
    const before = await snapshot(s.db, s.id);
    const calls = issueCalls(s.fetchMock).length;

    const res = await call(s, s.alice.cookie, s.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "no_divergence" });
    expect(await snapshot(s.db, s.id)).toEqual(before);
    expect(issueCalls(s.fetchMock)).toHaveLength(calls);
    await expectRefusedEntry(s, action, "no_divergence");
  });
});

describe("criterion H: taking GitHub's version needs a story that can be edited", () => {
  it.each(["in_progress", "in_review", "done", "abandoned"] as StoryStatus[])(
    "given a diverged %s story, when GitHub's version is taken, then 409 wrong_status, nothing changes, GitHub is not written and a refused entry is left",
    async (status) => {
      const s = await publishedStory();
      await setStatus(s.db, s.id, status);
      await editedByHand(s, (b) =>
        b.replace("**alors** t2", "**alors** t2-modifié"),
      );
      const before = await snapshot(s.db, s.id);
      const kept = await divergenceOf(s.db, s.id);
      const calls = issueCalls(s.fetchMock).length;

      const res = await takeGitHub(s, s.alice.cookie, s.id);

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "wrong_status" });
      expect(await snapshot(s.db, s.id)).toEqual(before);
      expect(await divergenceOf(s.db, s.id)).toEqual(kept);
      expect(issueCalls(s.fetchMock)).toHaveLength(calls);
      await expectRefusedEntry(s, "take_github_issue", "wrong_status");
    },
  );
});

describe("criterion F and H: a diverged story whose ticket was abandoned afterwards", () => {
  it("given a published story that diverged and whose ticket was then abandoned, when Cockpit's version is kept, then 200, the divergence is cleared, the issue gets Cockpit's render and is closed as not_planned, and one keep_cockpit_issue entry is ok", async () => {
    const s = await publishedStory();
    await editedByHand(s, (b) => `${b}\n\nUne ligne de trop`);
    expect(
      (await abandonTicket(s.app, s.alice.cookie, s.ticketId)).status,
    ).toBe(200);
    expect((await snapshot(s.db, s.id)).status).toBe("abandoned");
    expect((await divergenceOf(s.db, s.id)).issue_diverged_at).not.toBeNull();
    const calls = patches(s).length;

    const res = await keepCockpit(s, s.alice.cookie, s.id);

    expect(res.status).toBe(200);
    expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
    expect(patches(s).length).toBeGreaterThan(calls);
    expect(s.github.body).not.toContain("Une ligne de trop");
    expect(s.github.body).toContain("abandonnée");
    expect(s.github.state).toBe("closed");
    expect(s.github.stateReason).toBe("not_planned");
    expect(await entriesOf(s.db, "keep_cockpit_issue")).toEqual([
      expect.objectContaining({ result: "ok", story_id: s.id }),
    ]);
  });

  it("given a published story that diverged and whose ticket was then abandoned, when GitHub's version is taken, then 409 ticket_abandoned (the code path today), nothing changes and the story stays diverged", async () => {
    const s = await publishedStory();
    await editedByHand(s, (b) =>
      b.replace("**alors** t2", "**alors** t2-modifié"),
    );
    await abandonTicket(s.app, s.alice.cookie, s.ticketId);
    const before = await snapshot(s.db, s.id);
    const kept = await divergenceOf(s.db, s.id);
    const calls = issueCalls(s.fetchMock).length;

    const res = await takeGitHub(s, s.alice.cookie, s.id);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "ticket_abandoned" });
    expect(await snapshot(s.db, s.id)).toEqual(before);
    expect(await divergenceOf(s.db, s.id)).toEqual(kept);
    expect(issueCalls(s.fetchMock)).toHaveLength(calls);
  });
});
