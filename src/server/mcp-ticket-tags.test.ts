import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { callTool, dataOf, seedTicket, withProject } from "./test-mcp.ts";

// Slice 11.2, decision 055 I: Claude sees the priority and the tags, and still creates tickets the old way.
//
// Pinned: get_ticket answers `priority` ("low" | "normal" | "high") and `tags` (string[]) next to the existing fields.
// create_ticket keeps its input (title, description_md, project_id): the ticket it creates is normal with no tag.

describe("055 I: get_ticket", () => {
  it("given a high ticket with tags, when get_ticket is called, then it returns priority and tags next to the usual fields", async () => {
    const { app, db, alice, projectId } = await withProject();
    const id = await seedTicket(db, projectId, "Exporter", "du texte");
    await db.execute(
      sql`update tickets set priority = 'high', tags = array['export', 'compta'] where id = ${id}`,
    );

    const data = dataOf<Record<string, unknown>>(
      await callTool(app, alice.secret, "get_ticket", { ticket_id: id }),
    );

    expect(data).toMatchObject({
      id,
      title: "Exporter",
      step: "new",
      priority: "high",
      tags: ["export", "compta"],
    });
  });

  it("given a ticket without choice, when get_ticket is called, then priority is normal and tags is empty", async () => {
    const { app, db, alice, projectId } = await withProject();
    const id = await seedTicket(db, projectId, "Nu");

    const data = dataOf<Record<string, unknown>>(
      await callTool(app, alice.secret, "get_ticket", { ticket_id: id }),
    );

    expect(data).toMatchObject({ priority: "normal", tags: [] });
  });
});

describe("055 I: create_ticket", () => {
  it("given a title, when create_ticket is called, then the ticket is normal with no tag", async () => {
    const { app, alice, projectId } = await withProject();

    const created = dataOf<{ id: number }>(
      await callTool(app, alice.secret, "create_ticket", {
        project_id: projectId,
        title: "Idée de Claude",
      }),
    );
    const data = dataOf<Record<string, unknown>>(
      await callTool(app, alice.secret, "get_ticket", {
        ticket_id: created.id,
      }),
    );

    expect(data).toMatchObject({ priority: "normal", tags: [] });
  });
});
