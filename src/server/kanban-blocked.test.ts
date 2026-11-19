// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { userStories } from "./db/schema.ts";
import { seedStory, seedTicket, withProject } from "./test-mcp.ts";

// Decision 085 G (audit: « Carte Prête : la dépendance non terminée n'apparaît pas »): every card of
// GET /api/projects/:id/stories has `blockedBy: number | null`, the id of the first dependency of the story that is not done.

type Card = { id: number; blockedBy: number | null };

describe("decision 085 G: blockedBy on the cards of the Kanban", () => {
  it("given a ready story depending on an unfinished story and on a done one, when the Kanban is read, then blockedBy is the unfinished one, and null for a story with no dependency or only done ones", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticket = await seedTicket(db, projectId, "Le ticket");
    const finished = await seedStory(db, ticket, { status: "done" });
    const unfinished = await seedStory(db, ticket, { status: "in_progress" });
    const blocked = await seedStory(db, ticket, {
      status: "ready",
      dependsOn: [finished, unfinished],
    });
    const clear = await seedStory(db, ticket, {
      status: "ready",
      dependsOn: [finished],
    });
    const alone = await seedStory(db, ticket, { status: "ready" });

    const res = await app.request(`/api/projects/${projectId}/stories`, {
      headers: { cookie: alice.cookie },
    });

    expect(res.status).toBe(200);
    const cards = ((await res.json()) as { stories: Card[] }).stories;
    const of = (id: number) => cards.find((c) => c.id === id)?.blockedBy;
    expect(of(blocked)).toBe(unfinished);
    expect(of(clear)).toBeNull();
    expect(of(alone)).toBeNull();
  });

  it("given the dependency becomes done, when the Kanban is read again, then blockedBy is null", async () => {
    const { app, db, alice, projectId } = await withProject();
    const ticket = await seedTicket(db, projectId, "Le ticket");
    const first = await seedStory(db, ticket, { status: "in_progress" });
    const second = await seedStory(db, ticket, {
      status: "ready",
      dependsOn: [first],
    });
    await db
      .update(userStories)
      .set({ status: "done" })
      .where(eq(userStories.id, first));

    const res = await app.request(`/api/projects/${projectId}/stories`, {
      headers: { cookie: alice.cookie },
    });

    const cards = ((await res.json()) as { stories: Card[] }).stories;
    expect(cards.find((c) => c.id === second)?.blockedBy).toBeNull();
  });
});
