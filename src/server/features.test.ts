// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiModule, submit } from "./test-code-map.ts";
import { entryCount, send } from "./test-decisions.ts";
import { seedProject, userWithToken } from "./test-mcp.ts";
import {
  created,
  criterionRows,
  ready,
  rule,
  storyOf,
  withRules,
} from "./test-takeover.ts";

// Slice R3 (decision 048 A, B, C): GET /api/projects/:id/features, through app.request() on PGlite.
//
// Pinned shape (the decision leaves it open; src/web/test-features.tsx and the web tests use the same):
// - 200 { features: [Feature], links: [{ from, to, kind }] }
//   Feature = { id: <ticket id>, title: <title without « Reprise : »>, actors: string[],
//     rules: [{ id, storyId, storyStatus, summary, state: "pending" | "kept", given, when, then,
//               sources: [{ path, startLine, endLine, commitSha }], objects: [{ name, inMap }] }] }
// - Features: the takeover tickets of the project that are not abandoned, by ticket id. Actors: the distinct `as_a` of the non-abandoned takeover stories of the ticket,
//   compared without case nor edge spaces, in the order of the stories, spelled as the first one (trimmed). Rules: those of the non-abandoned takeover stories, whatever their
//   status, in the order of the story then the criterion; sources and objects as in GET /rules.
// - links: the map links (kind "references" | "contains", as stored) whose two ends are objects cited by a rule of the response; `{ from, to, kind }` only.
// - 404 { error: "Not found" } for a non-member, 401 without a session; a read, so no history entry.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Feature = {
  id: number;
  title: string;
  actors: string[];
  rules: {
    id: number;
    storyId: number;
    storyStatus: string;
    summary: string;
    state: string;
    given: string;
    when: string;
    then: string;
    sources: {
      path: string;
      startLine: number;
      endLine: number;
      commitSha: string;
    }[];
    objects: { name: string; inMap: boolean }[];
  }[];
};
type Body = {
  features: Feature[];
  links: { from: string; to: string; kind: string }[];
};
type Ctx = Awaited<ReturnType<typeof ready>>;

const read = (
  ctx: Pick<Ctx, "app" | "alice" | "projectId">,
  id = ctx.projectId,
) => send(ctx.app, ctx.alice.cookie, "GET", `/api/projects/${id}/features`);
const featuresOf = async (ctx: Pick<Ctx, "app" | "alice" | "projectId">) => {
  const res = await read(ctx);
  expect(res.status).toBe(200);
  return (await res.json()) as Body;
};

describe("decision 048 A, C: the features of a project", () => {
  it("given a takeover ticket « Reprise : Facturation », when a member reads the features, then it is one feature titled « Facturation » with its rules and their texts, state, story status, sources and objects", async () => {
    const ctx = await withRules();

    const { features } = await featuresOf(ctx);

    expect(features).toHaveLength(1);
    const [f] = features as [Feature];
    expect(f.id).toBe(ctx.ticketId);
    expect(f.title).toBe("Facturation");
    expect(f.rules.map((r) => r.summary)).toEqual([
      "règle-1",
      "règle-2",
      "règle-3",
    ]);
    expect(f.rules[0]).toMatchObject({
      id: ctx.ids[0],
      storyId: ctx.stories[0]?.id,
      storyStatus: "to_validate",
      state: "pending",
      given: "donné-1",
      when: "quand-1",
      then: "alors-1",
      sources: [
        { path: "api/src/db.ts", startLine: 5, endLine: 9, commitSha: ctx.sha },
        {
          path: "api/src/db.ts",
          startLine: 18,
          endLine: 24,
          commitSha: ctx.sha,
        },
      ],
      objects: [
        { name: "Order", inMap: true },
        { name: "Ghost", inMap: false },
      ],
    });
    expect(f.rules[2]?.objects).toEqual([]);
  });

  it("given two stories of one feature, when the features are read, then the actors are the distinct as_a, without regard to case or edge spaces, spelled as the first", async () => {
    const ctx = await ready();
    await created(
      ctx,
      [
        storyOf(1, [rule(1)], { as_a: "Client" }),
        storyOf(2, [rule(2)], { as_a: "  client " }),
        storyOf(3, [rule(3)], { as_a: "Comptable" }),
      ],
      { feature: "Facturer" },
    );

    const { features } = await featuresOf(ctx);

    expect(features[0]?.actors).toEqual(["Client", "Comptable"]);
  });

  it("given a rule that is kept and a story that is ready, when the features are read, then the rule says kept and its story ready, and the rule is still listed", async () => {
    const ctx = await withRules();
    const first = ctx.ids[0] as number;
    expect(
      (
        await send(
          ctx.app,
          ctx.alice.cookie,
          "POST",
          `/api/criteria/${first}/keep`,
        )
      ).status,
    ).toBe(200);
    await ctx.db.execute(
      sql`update user_stories set status = 'ready' where id = ${ctx.stories[1]?.id}`,
    );

    const { features } = await featuresOf(ctx);

    const rules = features[0]?.rules ?? [];
    expect(rules.map((r) => [r.summary, r.state, r.storyStatus])).toEqual([
      ["règle-1", "kept", "to_validate"],
      ["règle-2", "pending", "to_validate"],
      ["règle-3", "pending", "ready"],
    ]);
  });

  it("given two takeover tickets, when the features are read, then they come in the order of the tickets", async () => {
    const ctx = await ready();
    await created(ctx, [storyOf(1)], { feature: "B" });
    await created(ctx, [storyOf(2)], { feature: "A" });

    const { features } = await featuresOf(ctx);

    expect(features.map((f) => f.title)).toEqual(["B", "A"]);
  });

  it("given an abandoned takeover ticket, when the features are read, then it is not a feature", async () => {
    const ctx = await ready();
    const first = await created(ctx, [storyOf(1)], { feature: "Gardée" });
    const gone = await created(ctx, [storyOf(2)], { feature: "Abandonnée" });
    await ctx.db.execute(
      sql`update tickets set abandoned_at = now() where id = ${gone.ticket_id}`,
    );

    const { features } = await featuresOf(ctx);

    expect(features.map((f) => f.id)).toEqual([first.ticket_id]);
  });

  it("given an abandoned story, when the features are read, then its rules and its actor are not there", async () => {
    const ctx = await ready();
    const made = await created(
      ctx,
      [
        storyOf(1, [rule(1)], { as_a: "Client" }),
        storyOf(2, [rule(2)], { as_a: "Fantôme" }),
      ],
      { feature: "Facturer" },
    );
    await ctx.db.execute(
      sql`update user_stories set status = 'abandoned' where id = ${made.stories[1]?.id}`,
    );

    const { features } = await featuresOf(ctx);

    expect(features[0]?.actors).toEqual(["Client"]);
    expect(features[0]?.rules.map((r) => r.summary)).toEqual(["règle-1"]);
  });

  it("given an ordinary ticket with stories, when the features are read, then it is not a feature", async () => {
    const ctx = await ready();
    await ctx.db.execute(
      sql`insert into tickets (project_id, title, description_md) values (${ctx.projectId}, 'Idée', '')`,
    );

    expect((await featuresOf(ctx)).features).toEqual([]);
  });

  it("given a rule declared a bug, when the features are read, then it is gone from its feature", async () => {
    const ctx = await withRules();
    const [first, second] = ctx.ids as [number, number];
    expect(
      (
        await send(
          ctx.app,
          ctx.alice.cookie,
          "POST",
          `/api/criteria/${first}/bug`,
        )
      ).status,
    ).toBe(200);

    const { features } = await featuresOf(ctx);

    expect(features[0]?.rules.map((r) => r.id)).toEqual([second, ctx.ids[2]]);
    expect((await criterionRows(ctx.db)).some((r) => r.id === first)).toBe(
      false,
    );
  });

  it("given no takeover ticket, when the features are read, then 200 with no feature and no link", async () => {
    const ctx = await ready();

    expect(await featuresOf(ctx)).toEqual({ features: [], links: [] });
  });
});

describe("decision 048 B: the links of the map between the cited objects", () => {
  it("given rules citing Order and User, which the map links, when the features are read, then the link Order references User is there and the link of the uncited Invoice is not", async () => {
    const ctx = await withRules();

    const { links } = await featuresOf(ctx);

    expect(links).toEqual([{ from: "Order", to: "User", kind: "references" }]);
  });

  it("given a rule citing only Order, when the features are read, then there is no link: the other end is not shown", async () => {
    const ctx = await ready();
    await submit(ctx, [apiModule()]);
    await created(ctx, [storyOf(1, [rule(1, { object_names: ["Order"] })])]);

    expect((await featuresOf(ctx)).links).toEqual([]);
  });
});

describe("decision 048 C: access and isolation", () => {
  it("given a non-member, when he reads the features, then 404 and no entry is left", async () => {
    const ctx = await withRules();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const before = await entryCount(ctx.db);
    expect((await read(ctx)).status).toBe(200);

    const res = await send(
      ctx.app,
      bob.cookie,
      "GET",
      `/api/projects/${ctx.projectId}/features`,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(await entryCount(ctx.db)).toBe(before);
  });

  it("given no session, when the features are read, then 401", async () => {
    const ctx = await withRules();

    expect(
      (await ctx.app.request(`/api/projects/${ctx.projectId}/features`)).status,
    ).toBe(401);
  });

  it("given a member, when he reads the features, then the history gets no entry", async () => {
    const ctx = await withRules();
    const before = await entryCount(ctx.db);

    await featuresOf(ctx);

    expect(await entryCount(ctx.db)).toBe(before);
  });

  it("given the features of Alice's project, when another project of Alice reads its features, then it sees none", async () => {
    const ctx = await withRules();
    const other = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/other",
    });

    const res = await read(ctx, other);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ features: [], links: [] });
  });
});
