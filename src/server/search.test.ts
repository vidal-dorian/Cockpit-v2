import { describe, expect, it } from "vitest";
import { runs } from "./db/schema.ts";
import {
  archiveProject,
  seedProject,
  seedStory,
  seedTicket,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 15.3 (decision 073 A): GET /api/search?q=
//
// Pinned choices (the decision leaves them open):
// - 200 { stories: [{ id, title, projectId, ticketId, status }], tickets: [{ id, title, projectId, step }],
//   runs: [{ id, storyId, projectId, status }], projects: [{ id, fullName }] }: one array per group, always present.
//   A story's `title` is its `i_want`, as in the MCP tool.
// - `q` is trimmed, 2 to 200 characters (missing, shorter or longer: 400 { error: "Bad request" }); no session: 401.

type Found = {
  stories: { id: number; title: string; projectId: number; ticketId: number }[];
  tickets: { id: number; title: string; projectId: number }[];
  runs: { id: number; storyId: number; projectId: number }[];
  projects: { id: number; fullName: string }[];
};
const search = (
  ctx: Awaited<ReturnType<typeof withProject>>,
  q?: string,
  cookie: string | undefined = ctx.alice.cookie,
) =>
  ctx.app.request(
    `/api/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`,
    cookie ? { headers: { cookie } } : {},
  );
const found = async (res: Response) => {
  expect(res.status).toBe(200);
  return (await res.json()) as Found;
};
const ids = (list: { id: number }[]) => list.map((x) => x.id).sort();

async function addRun(
  ctx: Awaited<ReturnType<typeof withProject>>,
  storyId: number,
  userId = ctx.alice.id,
) {
  const [run] = await ctx.db
    .insert(runs)
    .values({ storyId, userId, status: "succeeded", modelActual: "sonnet" })
    .returning({ id: runs.id });
  return (run as { id: number }).id;
}

describe("slice 15.3 A: GET /api/search", () => {
  it("given projects, tickets and stories of the user and of another user, when lien expir is searched, then the matching ones of the user come grouped, without the archived project and without the other user's", async () => {
    const ctx = await withProject();
    const { db, alice, projectId } = ctx;
    const bob = await userWithToken(ctx.app, db, 2000);
    const bobProject = await seedProject(db, bob.id, {
      githubRepoId: 2,
      fullName: "user2000/lien-expire",
    });
    const archived = await seedProject(db, alice.id, {
      githubRepoId: 3,
      fullName: "user1000/lien-expire-ancien",
    });
    const mine = await seedProject(db, alice.id, {
      githubRepoId: 4,
      fullName: "user1000/LIEN-EXPIRE",
    });
    const hit = await seedTicket(db, projectId, "Le lien expire trop vite");
    await seedTicket(db, projectId, "Un lien seul");
    await seedTicket(db, bobProject, "Le lien expire chez Bob");
    const archivedTicket = await seedTicket(db, archived, "lien expire ancien");
    const storyHit = await seedStory(db, hit, {
      iWant: "renvoyer un lien expiré",
    });
    await seedStory(db, hit, { iWant: "afficher un lien" });
    await seedStory(db, await seedTicket(db, bobProject, "Autre"), {
      iWant: "lien expiré de Bob",
    });
    await seedStory(db, archivedTicket, { iWant: "lien expiré archivé" });
    await archiveProject(db, archived);

    const body = await found(await search(ctx, "lien expir"));

    expect(ids(body.projects)).toEqual([mine]);
    expect(ids(body.tickets)).toEqual([hit]);
    expect(body.tickets[0]).toMatchObject({
      title: "Le lien expire trop vite",
      projectId,
    });
    expect(ids(body.stories)).toEqual([storyHit]);
    expect(body.stories[0]).toMatchObject({
      title: "renvoyer un lien expiré",
      ticketId: hit,
      projectId,
    });
    expect(body.runs).toEqual([]);
  });

  it("given a query of 1 or 201 characters or none, when it is searched, then 400, and without a session 401", async () => {
    const ctx = await withProject();

    for (const q of ["a", "x".repeat(201), undefined])
      expect((await search(ctx, q)).status, String(q?.length)).toBe(400);
    expect((await search(ctx, "x".repeat(200))).status).toBe(200);
    expect((await search(ctx, "ab", undefined)).status).toBe(401);
  });

  it("given runs of the user and of another user, when the number of a run or « run N » is searched, then that run of the user is returned and nothing of the other user", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const story = await seedStory(db, await seedTicket(db, projectId, "Zéro"), {
      iWant: "ranger les rapports",
    });
    let target = 0;
    for (let i = 0; i < 17; i++) target = await addRun(ctx, story);
    const bob = await userWithToken(ctx.app, db, 2000);
    const bobStory = await seedStory(
      db,
      await seedTicket(
        db,
        await seedProject(db, bob.id, {
          githubRepoId: 2,
          fullName: "user2000/app",
        }),
        "Bob",
      ),
    );
    const bobRun = await addRun(ctx, bobStory, bob.id);

    for (const q of [String(target), `run ${target}`]) {
      const body = await found(await search(ctx, q));
      expect(ids(body.runs), q).toEqual([target]);
      expect(body.runs[0]).toMatchObject({ storyId: story, projectId });
    }
    expect((await found(await search(ctx, `run ${bobRun}`))).runs).toEqual([]);
  });

  it("given a run whose story narrative matches the words, when they are searched, then the run is returned with its story", async () => {
    const ctx = await withProject();
    const { db, projectId } = ctx;
    const story = await seedStory(db, await seedTicket(db, projectId, "Zéro"), {
      iWant: "exporter les factures en PDF",
    });
    const run = await addRun(ctx, story);

    const body = await found(await search(ctx, "factures pdf"));

    expect(ids(body.runs)).toEqual([run]);
    expect(ids(body.stories)).toEqual([story]);
  });
});
