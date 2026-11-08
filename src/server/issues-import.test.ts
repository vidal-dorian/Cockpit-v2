// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bobsStory, send } from "./test-decisions.ts";
import { githubCalls, issueCalls } from "./test-github.ts";
import {
  BUG_BODY,
  type Counts,
  criteriaOf,
  entriesButToken,
  importEntries,
  importIssues,
  linkStory,
  linkTicket,
  MENTION,
  REPO,
  STORY_BODY,
  STORY_PARTS,
  storyRows,
  ticketRows,
} from "./test-issue-import.ts";
import {
  archiveProject,
  historyText,
  seedStory,
  seedTicket,
  withProject,
} from "./test-mcp.ts";

// Decision 056 C and E (slice 11.3): POST /api/projects/:id/issues/import. The shapes are pinned at the top of test-issue-import.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof withProject>>;
const run = (s: Ctx, numbers: unknown) =>
  importIssues(s.app, s.alice.cookie, s.projectId, numbers);
const counts = async (res: Response) => (await res.json()) as Counts;

describe("056 C: who may import, and what is refused", () => {
  it("given no session, when an import is sent, then 401, nothing is created and GitHub is not called", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [{ number: 1, title: "Une" }]);

    const res = await send(
      s.app,
      "",
      "POST",
      `/api/projects/${s.projectId}/issues/import`,
      { numbers: [1] },
    );

    expect(res.status).toBe(401);
    expect(await ticketRows(s.db, s.projectId)).toEqual([]);
    expect(githubCalls(s.fetchMock)).toEqual([]);
  });

  it("given a project of another user and an unknown id, when an import is sent, then 404, nothing is created and GitHub is not called", async () => {
    const s = await withProject();
    const bob = await bobsStory(s);
    s.fetchMock.seedIssues(REPO, [{ number: 1, title: "Une" }]);

    for (const id of [bob.project, 99999]) {
      const res = await importIssues(s.app, s.alice.cookie, id, [1]);
      expect(res.status, `project ${id}`).toBe(404);
    }
    expect(await ticketRows(s.db, bob.project)).toHaveLength(1);
    expect(issueCalls(s.fetchMock)).toEqual([]);
  });

  it("given an archived project, when an import is sent, then 409 project_archived and nothing is created", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [{ number: 1, title: "Une" }]);
    await archiveProject(s.db, s.projectId);

    const res = await run(s, [1]);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(await ticketRows(s.db, s.projectId)).toEqual([]);
  });

  it.each([
    ["no numbers key", undefined],
    ["numbers that is not an array", "1,2"],
    ["an empty list", []],
    ["201 numbers", Array.from({ length: 201 }, (_, i) => i + 1)],
    ["a zero", [0]],
    ["a negative number", [-3]],
    ["a decimal", [1.5]],
    ["a string number", ["12"]],
    ["null", [null]],
  ])(
    "given %s, when an import is sent, then 400 Bad request, nothing is created, GitHub is not called and no history entry is left",
    async (_name, numbers) => {
      const s = await withProject();
      s.fetchMock.seedIssues(REPO, [
        { number: 1, title: "Une" },
        { number: 12, title: "Douze" },
      ]);

      const res = await run(s, numbers);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Bad request" });
      expect(await ticketRows(s.db, s.projectId)).toEqual([]);
      expect(issueCalls(s.fetchMock)).toEqual([]);
      expect(await entriesButToken(s.db)).toEqual([]);
    },
  );

  it("given 200 numbers none of which exists on GitHub, when an import is sent, then 200 and all 200 are skipped", async () => {
    const s = await withProject();

    const res = await run(
      s,
      Array.from({ length: 200 }, (_, i) => i + 1),
    );

    expect(res.status).toBe(200);
    expect(await counts(res)).toEqual({ tickets: 0, stories: 0, skipped: 200 });
  });

  it("given GitHub answers 500, when an import is sent, then 502 github_unavailable and nothing is created", async () => {
    const s = await withProject({ issuesStatus: 500 });

    const res = await run(s, [1]);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "github_unavailable" });
    expect(await ticketRows(s.db, s.projectId)).toEqual([]);
    expect(await storyRows(s.db, s.projectId)).toEqual([]);
  });
});

describe("056 C: the ticket made from an issue", () => {
  it("given an issue that is not a story, when it is imported, then a ticket is made from its title and body, with the normal priority, no tag, its issue number and no story", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      {
        number: 57,
        title: "Le bouton ne répond pas sur Safari",
        body: BUG_BODY,
      },
    ]);

    const res = await run(s, [57]);

    expect(res.status).toBe(200);
    expect(await counts(res)).toEqual({ tickets: 1, stories: 0, skipped: 0 });
    expect(await ticketRows(s.db, s.projectId)).toMatchObject([
      {
        title: "Le bouton ne répond pas sur Safari",
        description_md: BUG_BODY,
        priority: "normal",
        tags: [],
        github_issue_number: 57,
        stories_written_at: null,
      },
    ]);
    expect(await storyRows(s.db, s.projectId)).toEqual([]);
  });

  it("given an issue without body, when it is imported, then the description is empty", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [{ number: 5, title: "Sans corps" }]);

    await run(s, [5]);

    expect(await ticketRows(s.db, s.projectId)).toMatchObject([
      { title: "Sans corps", description_md: "" },
    ]);
  });

  it("given an issue titled with 256 characters, when it is imported, then the title of the ticket is its first 200", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 5, title: `${"T".repeat(100)}${"u".repeat(156)}` },
    ]);

    await run(s, [5]);

    expect((await ticketRows(s.db, s.projectId))[0]?.title).toBe(
      `${"T".repeat(100)}${"u".repeat(100)}`,
    );
  });

  it("given a body of 60,000 characters, when it is imported, then the description is 50,000 characters at most: the beginning of the body and the mention « (tronqué : la suite est sur GitHub) » at the end", async () => {
    const s = await withProject();
    const body = "abcdefghij".repeat(6_000);
    s.fetchMock.seedIssues(REPO, [{ number: 5, title: "Long", body }]);

    await run(s, [5]);

    const text = (await ticketRows(s.db, s.projectId))[0]?.description_md ?? "";
    expect(text.length).toBeLessThanOrEqual(50_000);
    expect(text.endsWith(MENTION)).toBe(true);
    expect(text.startsWith(body.slice(0, 49_900))).toBe(true);
  });

  // Review of 11.3: a cut in the middle of an emoji (a surrogate pair) must not leave half of it.
  it("given a title and a body whose cut falls in the middle of an emoji, when they are imported, then the stored texts hold no lone surrogate and no U+FFFD", async () => {
    const s = await withProject();
    const keep = 50_000 - MENTION.length;
    const body = `${"a".repeat(keep - 1)}😀${"b".repeat(100)}`;
    s.fetchMock.seedIssues(REPO, [
      { number: 5, title: `${"T".repeat(199)}😀${"u".repeat(20)}`, body },
    ]);

    await run(s, [5]);

    const [ticket] = await ticketRows(s.db, s.projectId);
    for (const text of [ticket?.title ?? "", ticket?.description_md ?? ""]) {
      expect(text.isWellFormed()).toBe(true);
      expect(text).not.toContain("\uFFFD");
    }
    expect(ticket?.title).toBe("T".repeat(199));
    expect(ticket?.description_md.length).toBeLessThanOrEqual(50_000);
    expect(ticket?.description_md.endsWith(MENTION)).toBe(true);
  });

  it("given a title with spaces around it and 250 characters after them, when it is imported, then it is trimmed before the cut to 200", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 5, title: `  ${"T".repeat(250)}` },
      { number: 6, title: "   Un titre   " },
    ]);

    await run(s, [5, 6]);

    expect(
      (await ticketRows(s.db, s.projectId)).map((t) => t.title).sort(),
    ).toEqual(["T".repeat(200), "Un titre"].sort());
  });

  it("given a body of exactly 50,000 characters, when it is imported, then it is kept whole, without the mention", async () => {
    const s = await withProject();
    const body = "abcdefghij".repeat(5_000);
    s.fetchMock.seedIssues(REPO, [{ number: 5, title: "Juste", body }]);

    await run(s, [5]);

    expect((await ticketRows(s.db, s.projectId))[0]?.description_md).toBe(body);
  });

  it("given an imported ticket, when the tickets and the ticket are read, then they carry githubIssueNumber (57 for the import, null for a ticket made by hand) and the step is new", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 57, title: "Importée", body: BUG_BODY },
    ]);
    const manual = await seedTicket(s.db, s.projectId, "À la main");
    await run(s, [57]);

    const list = await send(
      s.app,
      s.alice.cookie,
      "GET",
      `/api/projects/${s.projectId}/tickets`,
    );
    const { tickets } = (await list.json()) as {
      tickets: {
        id: number;
        title: string;
        githubIssueNumber: number | null;
        step: string;
      }[];
    };
    const imported = tickets.find((t) => t.title === "Importée");
    expect(imported).toMatchObject({ githubIssueNumber: 57, step: "new" });
    expect(tickets.find((t) => t.id === manual)?.githubIssueNumber).toBeNull();
    const one = await send(
      s.app,
      s.alice.cookie,
      "GET",
      `/api/tickets/${imported?.id}`,
    );
    expect(
      ((await one.json()) as { ticket: { githubIssueNumber: number | null } })
        .ticket.githubIssueNumber,
    ).toBe(57);
  });
});

describe("056 C: the story made from an issue written as one", () => {
  it("given an issue written as a user story, when it is imported, then a ticket and one ready story are made, with the narrative, the criteria in order, the issue number, no body hash, and the ticket is marked as written", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 58, title: "Exporter les tâches en PDF", body: STORY_BODY },
    ]);

    const res = await run(s, [58]);

    expect(await counts(res)).toEqual({ tickets: 1, stories: 1, skipped: 0 });
    const [ticket] = await ticketRows(s.db, s.projectId);
    expect(ticket).toMatchObject({
      title: "Exporter les tâches en PDF",
      description_md: STORY_BODY,
      github_issue_number: 58,
    });
    expect(ticket?.stories_written_at).not.toBeNull();
    const stories = await storyRows(s.db, s.projectId);
    expect(stories).toHaveLength(1);
    const story = stories[0];
    expect(story).toMatchObject({
      ticket_id: ticket?.id,
      position: 1,
      status: "ready",
      as_a: STORY_PARTS.asA,
      i_want: STORY_PARTS.iWant,
      so_that: STORY_PARTS.soThat,
      notes_md: "",
      issue_number: 58,
      issue_body_hash: null,
    });
    expect(await criteriaOf(s.db, story?.id as number)).toEqual(
      STORY_PARTS.criteria.map((c, i) => ({ position: i + 1, ...c })),
    );
  });

  it("given an imported story, when the ticket is read, then its step is validated", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 58, title: "Exporter", body: STORY_BODY },
    ]);
    await run(s, [58]);

    const list = await send(
      s.app,
      s.alice.cookie,
      "GET",
      `/api/projects/${s.projectId}/tickets`,
    );

    const { tickets } = (await list.json()) as { tickets: { step: string }[] };
    expect(tickets.map((t) => t.step)).toEqual(["validated"]);
  });

  it("given a story issue of more than 20 criteria, when it is imported, then it becomes a ticket that waits for its stories", async () => {
    const s = await withProject();
    const many = Array.from(
      { length: 21 },
      (_, i) => `- Étant donné a${i}, quand b${i}, alors c${i}`,
    );
    s.fetchMock.seedIssues(REPO, [
      {
        number: 8,
        title: "Trop de critères",
        body: [
          "En tant que lectrice, je veux tout, afin de tout.",
          "",
          ...many,
        ].join("\n"),
      },
    ]);

    expect(await counts(await run(s, [8]))).toEqual({
      tickets: 1,
      stories: 0,
      skipped: 0,
    });
    expect(
      (await ticketRows(s.db, s.projectId))[0]?.stories_written_at,
    ).toBeNull();
    expect(await storyRows(s.db, s.projectId)).toEqual([]);
  });
});

describe("056 C: Cockpit reads GitHub again", () => {
  it("given the title and the body changed on GitHub after the list was shown, when the import is sent, then the ticket has what GitHub holds now, and a bug turned into a story is a story", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 57, title: "Titre au moment de la liste", body: BUG_BODY },
    ]);
    const issue = s.fetchMock.issues(REPO)[0];
    if (!issue) throw new Error("seeded");
    issue.title = "Titre modifié depuis";
    issue.body = STORY_BODY;

    const res = await run(s, [57]);

    expect(await counts(res)).toEqual({ tickets: 1, stories: 1, skipped: 0 });
    expect((await ticketRows(s.db, s.projectId))[0]).toMatchObject({
      title: "Titre modifié depuis",
      description_md: STORY_BODY,
    });
  });

  it("given the numbers of a closed issue, a pull request, an unknown issue and two issues already in Cockpit are sent with an open one, when the import is sent, then only the open one is imported and the others are skipped", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 1, title: "Ouverte", body: BUG_BODY },
      { number: 2, title: "Fermée", state: "closed" },
      { number: 3, title: "Une pull request", pull: true },
      { number: 4, title: "Déjà une US" },
      { number: 5, title: "Déjà un ticket" },
    ]);
    const storyId = await seedStory(
      s.db,
      await seedTicket(s.db, s.projectId, "T"),
    );
    await linkStory(s.db, storyId, 4);
    await linkTicket(s.db, await seedTicket(s.db, s.projectId, "U"), 5);

    const res = await run(s, [1, 2, 3, 4, 5, 999]);

    expect(await counts(res)).toEqual({ tickets: 1, stories: 0, skipped: 5 });
    expect(
      (await ticketRows(s.db, s.projectId)).map((t) => t.github_issue_number),
    ).toEqual([null, 5, 1]);
  });

  it("given the same number twice in the request, when the import is sent, then one ticket is made and nothing is skipped", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [{ number: 7, title: "Une" }]);

    const res = await run(s, [7, 7]);

    expect(await counts(res)).toEqual({ tickets: 1, stories: 0, skipped: 0 });
    expect(await ticketRows(s.db, s.projectId)).toHaveLength(1);
  });
});

describe("056 C: the history", () => {
  it("given an import of a story, a bug and a closed issue, when it is done, then ONE import_issues entry (human, ui, the user, the project) holds the three counts and no text", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 1, title: "TitreSecretZQX", body: STORY_BODY },
      {
        number: 2,
        title: "AutreSecretZQX",
        body: `${BUG_BODY} CorpsSecretZQX`,
      },
      { number: 3, title: "Fermée", state: "closed" },
    ]);

    await run(s, [1, 2, 3]);

    const found = await importEntries(s.db);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: s.alice.id,
      project_id: s.projectId,
      ticket_id: null,
      story_id: null,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { tickets: 2, stories: 1, skipped: 1 },
    });
    expect(await historyText(s.db)).not.toContain("SecretZQX");
  });
});

describe("056 E: no duplicate", () => {
  it("given an import already done, when the same numbers are imported again, then nothing is created and every number is skipped", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 1, title: "Une", body: STORY_BODY },
      { number: 2, title: "Deux", body: BUG_BODY },
    ]);
    await run(s, [1, 2]);

    const again = await run(s, [1, 2]);

    expect(again.status).toBe(200);
    expect(await counts(again)).toEqual({ tickets: 0, stories: 0, skipped: 2 });
    expect(await ticketRows(s.db, s.projectId)).toHaveLength(2);
    expect(await storyRows(s.db, s.projectId)).toHaveLength(1);
  });

  it("given two imports of the same issues sent at the same time, when both are done, then each issue has one ticket and the counts add up to one import", async () => {
    const s = await withProject();
    s.fetchMock.seedIssues(REPO, [
      { number: 1, title: "Une", body: STORY_BODY },
      { number: 2, title: "Deux", body: BUG_BODY },
      { number: 3, title: "Trois", body: BUG_BODY },
    ]);

    const [a, b] = await Promise.all([run(s, [1, 2, 3]), run(s, [1, 2, 3])]);

    expect([a.status, b.status]).toEqual([200, 200]);
    const [first, second] = [await counts(a), await counts(b)];
    expect(first.tickets + second.tickets).toBe(3);
    expect(first.stories + second.stories).toBe(1);
    expect(first.skipped + second.skipped).toBe(3);
    const tickets = await ticketRows(s.db, s.projectId);
    expect(tickets.map((t) => t.github_issue_number).sort()).toEqual([1, 2, 3]);
    expect(await storyRows(s.db, s.projectId)).toHaveLength(1);
  });
});

describe("056 E: a concurrent import wins between the read and the insert", () => {
  // Review of 11.3: the conflict branch. A ticket for the issue 57 appears while the server reads GitHub: the import answers 200 and skips it, never a 500.
  it("given a ticket from the issue 57 is created while the import reads GitHub, when the import of 57 and 58 ends, then 200 with 57 skipped and 58 imported", async () => {
    const holder: { db?: Ctx["db"]; projectId?: number } = {};
    let done = false;
    const s = await withProject({
      beforeIssuesRead: async () => {
        if (done || !holder.db) return;
        done = true;
        await linkTicket(
          holder.db,
          await seedTicket(
            holder.db,
            holder.projectId as number,
            "Arrivé entre-temps",
          ),
          57,
        );
      },
    });
    holder.db = s.db;
    holder.projectId = s.projectId;
    s.fetchMock.seedIssues(REPO, [
      { number: 57, title: "Perdue", body: BUG_BODY },
      { number: 58, title: "Gagnée", body: BUG_BODY },
    ]);

    const res = await run(s, [57, 58]);

    expect(res.status).toBe(200);
    expect(await counts(res)).toEqual({ tickets: 1, stories: 0, skipped: 1 });
    expect(
      (await ticketRows(s.db, s.projectId))
        .map((t) => t.github_issue_number)
        .sort(),
    ).toEqual([57, 58]);
  });
});

describe("056 E: the unique index", () => {
  const insert = (s: Ctx, projectId: number, number: number | null) =>
    s.db.execute(
      sql`insert into tickets (project_id, title, description_md, github_issue_number) values (${projectId}, 'T', '', ${number})`,
    );
  /** Drizzle wraps the driver error: the constraint text is in the cause (as findings-github-schema.test.ts reads it). */
  const refused = async (query: Promise<unknown>) => {
    const error = await query.then(
      () => null,
      (e: unknown) => e,
    );
    const cause = (error as { cause?: unknown } | null)?.cause;
    expect(error, "the insert must be refused").not.toBeNull();
    expect(
      `${(error as Error).message} ${(cause as Error | undefined)?.message ?? ""}`,
    ).toMatch(/unique|duplicate/i);
  };

  it("given a ticket of a project made from the issue 57, when a second ticket of the same project is made from it, then the index refuses it", async () => {
    const s = await withProject();
    await insert(s, s.projectId, 57);

    await refused(insert(s, s.projectId, 57));
  });

  it("given tickets without issue number and a ticket of another project from the issue 57, when one is made from 57 here, then all are accepted", async () => {
    const s = await withProject();
    const bob = await bobsStory(s);
    await insert(s, bob.project, 57);

    await insert(s, s.projectId, null);
    await insert(s, s.projectId, null);
    await insert(s, s.projectId, 57);

    expect(await ticketRows(s.db, s.projectId)).toHaveLength(3);
  });
});
