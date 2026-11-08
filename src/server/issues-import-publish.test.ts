import { afterEach, describe, expect, it, vi } from "vitest";
import { abandonStory, send } from "./test-decisions.ts";
import { issueCalls } from "./test-github.ts";
import {
  divergenceOf,
  editOnGitHub,
  entriesOf,
  NOT_DIVERGED,
} from "./test-issue-edit.ts";
import {
  BUG_BODY,
  importIssues,
  linkStory,
  linkTicket,
  REPO,
  REPO_ID,
  STORY_BODY,
  storyRows,
} from "./test-issue-import.ts";
import { seedStory, seedTicket, withProject } from "./test-mcp.ts";

// Decision 056 D (slice 11.3): the import writes nothing on GitHub; the issue of an imported story is the issue of that story from its next publication on,
// and an edit made on GitHub before that publication is no divergence. The shapes are pinned at the top of test-issue-import.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof withProject>>;

/** Issue 58 (a story) and 57 (a bug) are on GitHub; both are imported. Returns the id of the imported story. */
async function imported() {
  const s = await withProject();
  s.fetchMock.seedIssues(REPO, [
    { number: 57, title: "Un bug", body: BUG_BODY },
    { number: 58, title: "Exporter les tâches en PDF", body: STORY_BODY },
  ]);
  const res = await importIssues(s.app, s.alice.cookie, s.projectId, [57, 58]);
  expect(res.status, "the import must work for this test").toBe(200);
  const [story] = await storyRows(s.db, s.projectId);
  expect(story, "the story issue became a story").toBeDefined();
  return { ...s, storyId: (story as { id: number }).id };
}
const publish = (s: Ctx, id: number) =>
  send(s.app, s.alice.cookie, "POST", `/api/stories/${id}/publish`);

describe("056 D: the import writes nothing on GitHub", () => {
  it("given an import of a story and a bug, when it is done, then no write call was made, the issues are as they were and no sync entry exists", async () => {
    const s = await imported();

    expect(issueCalls(s.fetchMock).filter((c) => c.method !== "GET")).toEqual(
      [],
    );
    const [bug, story] = s.fetchMock.issues(REPO);
    expect(bug).toMatchObject({ title: "Un bug", body: BUG_BODY, labels: [] });
    expect(story).toMatchObject({
      title: "Exporter les tâches en PDF",
      body: STORY_BODY,
      labels: [],
    });
    expect(s.fetchMock.labels(REPO)).toEqual([]);
    expect(await entriesOf(s.db, "sync_issue")).toEqual([]);
  });
});

describe("056 D: the next publication reuses the issue", () => {
  it("given an imported story, when it is published, then issue 58 is rewritten with the template and the label cockpit: prête, and no second issue is created", async () => {
    const s = await imported();

    const res = await publish(s, s.storyId);

    expect(res.status).toBe(200);
    const calls = issueCalls(s.fetchMock);
    expect(
      calls.filter(
        (c) => c.method === "POST" && c.path === `/repos/${REPO}/issues`,
      ),
    ).toEqual([]);
    expect(
      calls.some(
        (c) => c.method === "PATCH" && c.path === `/repos/${REPO}/issues/58`,
      ),
    ).toBe(true);
    const issues = s.fetchMock.issues(REPO);
    expect(issues.map((i) => i.number)).toEqual([57, 58]);
    const issue = issues[1];
    expect(issue?.title).toBe("exporter mes tâches en PDF");
    expect(issue?.body).toContain(
      "En tant que lectrice, je veux exporter mes tâches en PDF, afin de les partager.",
    );
    expect(issue?.body).toContain("**Statut** : prête");
    expect(issue?.body).toContain(`<!-- cockpit:story:${s.storyId} -->`);
    expect(issue?.labels).toEqual(["cockpit: prête"]);
    expect(issues[0]).toMatchObject({
      title: "Un bug",
      body: BUG_BODY,
      labels: [],
    });
    const [story] = await storyRows(s.db, s.projectId);
    expect(story?.issue_number).toBe(58);
    expect(story?.issue_body_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("given an imported story, when it is abandoned, then issue 58 is closed as not_planned with the label cockpit: abandonnée, and no issue is created", async () => {
    const s = await imported();

    const res = await abandonStory(s.app, s.alice.cookie, s.storyId);

    expect(res.status).toBe(200);
    const issues = s.fetchMock.issues(REPO);
    expect(issues.map((i) => i.number)).toEqual([57, 58]);
    expect(issues[1]).toMatchObject({
      state: "closed",
      stateReason: "not_planned",
      labels: ["cockpit: abandonnée"],
    });
    expect(issues[0]).toMatchObject({ state: "open", labels: [] });
  });
});

describe("056 D: an edit on GitHub before the first publication", () => {
  it("given an imported story (its ticket comes from the issue 58, the story has issue 58, no body hash), when the issue is edited on GitHub, then the story is not marked diverged and no issue_diverged entry is written", async () => {
    const s = await withProject();
    const ticket = await seedTicket(s.db, s.projectId, "Importé");
    await linkTicket(s.db, ticket, 58);
    const storyId = await seedStory(s.db, ticket, { status: "ready" });
    await linkStory(s.db, storyId, 58);

    await editOnGitHub(s.db, {
      number: 58,
      title: "Un autre titre",
      body: "Un autre corps, écrit à la main.",
      repoId: REPO_ID,
    });

    expect(await divergenceOf(s.db, storyId)).toMatchObject({
      ...NOT_DIVERGED,
      issue_body_hash: null,
    });
    expect(await entriesOf(s.db, "issue_diverged")).toEqual([]);
  });

  // Review of 11.3 (B2): only an imported story is exempt. A story Cockpit created the issue of has a null hash too when the last step of its sync failed
  // (the number is saved at once, the hash only at the end): an edit on GitHub must still diverge it (decision 025).
  it("given a story published by Cockpit whose hash stayed null (the end of its sync failed), whose ticket is not from an issue, when the issue is edited on GitHub, then the story diverges", async () => {
    const s = await withProject();
    const ticket = await seedTicket(s.db, s.projectId, "Écrit dans Cockpit");
    const storyId = await seedStory(s.db, ticket, { status: "ready" });
    await linkStory(s.db, storyId, 58);

    await editOnGitHub(s.db, {
      number: 58,
      title: "Un autre titre",
      body: "Un autre corps, écrit à la main.",
      repoId: REPO_ID,
    });

    expect(
      (await divergenceOf(s.db, storyId)).issue_diverged_at,
    ).not.toBeNull();
    expect(await entriesOf(s.db, "issue_diverged")).toHaveLength(1);
  });

  it("given a ticket imported from the issue 57 and a story of it published by Cockpit as issue 58 with a null hash, when the issue 58 is edited on GitHub, then the story diverges (the numbers differ, so it is not an imported story)", async () => {
    const s = await withProject();
    const ticket = await seedTicket(s.db, s.projectId, "Importé");
    await linkTicket(s.db, ticket, 57);
    const storyId = await seedStory(s.db, ticket, { status: "ready" });
    await linkStory(s.db, storyId, 58);

    await editOnGitHub(s.db, {
      number: 58,
      title: "Un autre titre",
      body: "Un autre corps",
      repoId: REPO_ID,
    });

    expect(
      (await divergenceOf(s.db, storyId)).issue_diverged_at,
    ).not.toBeNull();
  });

  it("given an imported story published once, when the issue is edited on GitHub afterwards, then the story diverges as any published story does (decision 025)", async () => {
    const s = await imported();
    expect((await publish(s, s.storyId)).status).toBe(200);

    await editOnGitHub(s.db, {
      number: 58,
      title: "Un titre humain",
      body: "Un corps humain",
      repoId: REPO_ID,
    });

    expect(
      (await divergenceOf(s.db, s.storyId)).issue_diverged_at,
    ).not.toBeNull();
    expect(await entriesOf(s.db, "issue_diverged")).toHaveLength(1);
  });
});
