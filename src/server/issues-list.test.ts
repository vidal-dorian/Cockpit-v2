import { afterEach, describe, expect, it, vi } from "vitest";
import { bobsStory } from "./test-decisions.ts";
import { githubCalls, issueCalls } from "./test-github.ts";
import {
  BUG_BODY,
  entriesButToken,
  type Listed,
  linkStory,
  linkTicket,
  listIssues,
  REPO,
  STORY_BODY,
} from "./test-issue-import.ts";
import { seedStory, seedTicket, withProject } from "./test-mcp.ts";

// Decision 056 A (slice 11.3): GET /api/projects/:id/issues. The shapes are pinned at the top of test-issue-import.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

const read = async (res: Response) =>
  ((await res.json()) as { issues: Listed[] }).issues;
const byNumber = (list: Listed[]) =>
  [...list].sort((a, b) => a.number - b.number);

describe("056 A: who may read", () => {
  it("given no session, when the issues are listed, then 401 and GitHub is not called", async () => {
    const s = await withProject();

    const res = await listIssues(s.app, null, s.projectId);

    expect(res.status).toBe(401);
    expect(githubCalls(s.fetchMock)).toEqual([]);
  });

  it("given a project of another user and an unknown id, when the issues are listed, then 404 and GitHub is not called", async () => {
    const s = await withProject();
    const bob = await bobsStory(s);

    for (const id of [bob.project, 99999, "abc"]) {
      const res = await listIssues(s.app, s.alice.cookie, id);
      expect(res.status, `project ${id}`).toBe(404);
    }
    expect(issueCalls(s.fetchMock)).toEqual([]);
  });
});

describe("056 A: what is listed", () => {
  it("given open and closed issues and a pull request among them, when the issues are listed, then each issue has number, title, state, kind and inCockpit, and the pull request is absent", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 1, title: "Exporter les tâches", body: STORY_BODY },
      { number: 2, title: "Bug Safari", body: BUG_BODY },
      { number: 3, title: "Question sur la licence", state: "closed" },
      { number: 4, title: "Une pull request", pull: true },
    ]);

    const res = await listIssues(s.app, s.alice.cookie, s.projectId);

    expect(res.status).toBe(200);
    expect(byNumber(await read(res))).toEqual([
      {
        number: 1,
        title: "Exporter les tâches",
        state: "open",
        kind: "story",
        inCockpit: null,
      },
      {
        number: 2,
        title: "Bug Safari",
        state: "open",
        kind: "ticket",
        inCockpit: null,
      },
      {
        number: 3,
        title: "Question sur la licence",
        state: "closed",
        kind: "ticket",
        inCockpit: null,
      },
    ]);
  });

  it("given the listing, when GitHub is read, then the closed issues are asked for too (state=all, 100 per page) with the token of the installation", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [{ number: 1, title: "Une issue" }]);

    await listIssues(s.app, s.alice.cookie, s.projectId);

    const reads = issueCalls(s.fetchMock);
    expect(reads.length).toBeGreaterThan(0);
    for (const call of reads) {
      expect(call.method).toBe("GET");
      expect(call.path).toBe(`/repos/${REPO}/issues`);
      expect(new URLSearchParams(call.search).get("state")).toBe("all");
      expect(new URLSearchParams(call.search).get("per_page")).toBe("100");
    }
  });

  it("given a story of the project has the issue 1 and a ticket of the project comes from the issue 2, when the issues are listed, then inCockpit says { storyId } and { ticketId }, and null for the others", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 1, title: "Déjà une US" },
      { number: 2, title: "Déjà un ticket" },
      { number: 3, title: "Libre" },
    ]);
    const ticketA = await seedTicket(s.db, s.projectId, "Le ticket A");
    const storyId = await seedStory(s.db, ticketA);
    await linkStory(s.db, storyId, 1);
    const ticketId = await seedTicket(s.db, s.projectId, "Le ticket B");
    await linkTicket(s.db, ticketId, 2);

    const found = byNumber(
      await read(await listIssues(s.app, s.alice.cookie, s.projectId)),
    );

    expect(found.map((i) => i.inCockpit)).toEqual([
      { storyId },
      { ticketId },
      null,
    ]);
  });

  it("given another user's project holds a story and a ticket for the issue 1 and 2, when my issues are listed, then they do not count: inCockpit stays null", async () => {
    const s = await withProject();
    const bob = await bobsStory(s);
    await linkStory(s.db, bob.storyId, 1);
    await linkTicket(s.db, await seedTicket(s.db, bob.project, "Autre"), 2);
    s.fetchMock.seedIssues(REPO, [
      { number: 1, title: "Un" },
      { number: 2, title: "Deux" },
    ]);

    const found = await read(
      await listIssues(s.app, s.alice.cookie, s.projectId),
    );

    expect(found.map((i) => i.inCockpit)).toEqual([null, null]);
  });
});

describe("056 A: the pages", () => {
  it("given 250 issues, when the issues are listed, then the three pages are followed and all 250 are listed", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(
      REPO,
      Array.from({ length: 250 }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
      })),
    );

    const found = await read(
      await listIssues(s.app, s.alice.cookie, s.projectId),
    );

    expect(found).toHaveLength(250);
    expect(new Set(found.map((i) => i.number)).size).toBe(250);
    expect(issueCalls(s.fetchMock)).toHaveLength(3);
  });

  it("given 1,050 issues, when the issues are listed, then 10 pages are read at most and the 50 oldest are not listed", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(
      REPO,
      Array.from({ length: 1_050 }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
      })),
    );

    const found = await read(
      await listIssues(s.app, s.alice.cookie, s.projectId),
    );

    expect(issueCalls(s.fetchMock)).toHaveLength(10);
    expect(found).toHaveLength(1_000);
    expect(Math.min(...found.map((i) => i.number))).toBe(51);
    expect(Math.max(...found.map((i) => i.number))).toBe(1_050);
  });

  it("given a repo where pull requests take the first page, when the issues are listed, then the pull requests that fill the pages are never listed", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      ...Array.from({ length: 120 }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
      })),
      ...Array.from({ length: 100 }, (_, i) => ({
        number: i + 121,
        title: `PR ${i + 121}`,
        pull: true,
      })),
    ]);

    const found = await read(
      await listIssues(s.app, s.alice.cookie, s.projectId),
    );

    expect(found).toHaveLength(120);
    expect(found.every((i) => i.title.startsWith("Issue"))).toBe(true);
  });
});

describe("056 A: GitHub is down, and what the read leaves", () => {
  it("given GitHub answers 500, when the issues are listed, then 502 github_unavailable and no history entry", async () => {
    const s = await withProject({ issuesStatus: 500 });

    const res = await listIssues(s.app, s.alice.cookie, s.projectId);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
    expect(await entriesButToken(s.db)).toEqual([]);
  });

  it("given a successful read, when the issues are listed, then nothing is written on GitHub and no history entry is left", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 1, title: "Une", body: STORY_BODY },
    ]);

    const res = await listIssues(s.app, s.alice.cookie, s.projectId);

    expect(res.status).toBe(200);
    expect(issueCalls(s.fetchMock).filter((c) => c.method !== "GET")).toEqual(
      [],
    );
    expect(await entriesButToken(s.db)).toEqual([]);
  });
});
