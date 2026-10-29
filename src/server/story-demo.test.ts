// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abandonStory,
  send,
  sendBack,
  snapshot,
  storyHistory,
  validate,
} from "./test-decisions.ts";
import {
  callTool,
  dataOf,
  expectRefused,
  historyText,
  seedTicket,
  withProject,
} from "./test-mcp.ts";

// Slice 4.4, the demo of the slice: "I send a story back, Claude rewrites it, I validate it; Claude can neither
// validate nor abandon (a refusal is journaled)". One test, the whole flow, through the two doors (MCP and UI routes).

afterEach(() => {
  vi.unstubAllGlobals();
});

type Listed = {
  tickets: { id: number }[];
  stories_to_rewrite: { id: number; rewrite_comment: string | null }[];
};

describe("criterion 10: the demo flow", () => {
  it("given a ticket, when Claude writes two stories, the human sends one back, Claude rewrites it and the human validates it, then it is ready, Claude's attempts to validate or abandon are refused and journaled, and the history shows both actors in order", async () => {
    const ctx = await withProject();
    const { app, db, alice } = ctx;
    const ticketId = await seedTicket(db, ctx.projectId, "Exporter", "idée");
    const claude = (name: string, args: unknown) =>
      callTool(app, alice.secret, name, args);
    const list = async () =>
      dataOf<Listed>(await claude("list_tickets_needing_us", {}));

    // 1. Claude writes two stories.
    const created = dataOf<{ stories: { id: number }[] }>(
      await claude("create_user_stories", {
        ticket_id: ticketId,
        stories: [1, 2].map((n) => ({
          as_a: `rôle-${n}`,
          i_want: `vouloir-${n}`,
          so_that: `but-${n}`,
          criteria: [{ given: `g-${n}`, when: `w-${n}`, then: `t-${n}` }],
        })),
      }),
    );
    const [a, b] = created.stories.map((s) => s.id) as [number, number];
    expect((await snapshot(db, a)).status).toBe("to_validate");

    // 2. The human sends the first one back; Claude finds it with the comment.
    const comment = "Précise-le-cas-vide-ZQX";
    expect((await sendBack(app, alice.cookie, a, { comment })).status).toBe(
      200,
    );
    const waiting = await list();
    expect(
      waiting.stories_to_rewrite.map((s) => [s.id, s.rewrite_comment]),
    ).toEqual([[a, comment]]);

    // 3. Claude rewrites it: it goes back to the human, the comment is gone.
    const rewritten = dataOf<{ story: { id: number; status: string } }>(
      await claude("update_user_story", {
        story_id: a,
        as_a: "rôle-1 réécrit",
        i_want: "vouloir-1 réécrit",
        so_that: "but-1 réécrit",
        criteria: [
          { given: "g-1 bis", when: "w-1 bis", then: "t-1 bis" },
          { given: "g-1 ter", when: "w-1 ter", then: "t-1 ter" },
        ],
      }),
    );
    expect(rewritten.story).toMatchObject({ id: a, status: "to_validate" });
    expect((await list()).stories_to_rewrite).toEqual([]);
    expect(await snapshot(db, a)).toMatchObject({
      status: "to_validate",
      rewriteComment: null,
      iWant: "vouloir-1 réécrit",
    });

    // 4. The human validates it.
    const validated = await validate(app, alice.cookie, a);
    expect(validated.status).toBe(200);
    expect((await snapshot(db, a)).status).toBe("ready");

    // 5. Claude can neither validate nor abandon, nor rewrite a story that is not to be rewritten.
    expectRefused(await claude("validate_user_story", { story_id: b }));
    expectRefused(await claude("abandon_user_story", { story_id: b }));
    expectRefused(
      await claude("update_user_story", {
        story_id: a,
        as_a: "x",
        i_want: "y",
        so_that: "z",
        criteria: [{ given: "g", when: "w", then: "t" }],
      }),
    );
    expect((await snapshot(db, a)).status).toBe("ready");
    expect((await snapshot(db, b)).status).toBe("to_validate");

    // 6. The ticket follows: one story ready, one to validate; abandoning the second leaves the ticket validated.
    const step = async () =>
      (
        (await (
          await send(app, alice.cookie, "GET", `/api/tickets/${ticketId}`)
        ).json()) as { ticket: { step: string } }
      ).ticket.step;
    expect(await step()).toBe("to_validate");
    expect((await abandonStory(app, alice.cookie, b)).status).toBe(200);
    expect(await step()).toBe("validated");

    // 7. The history: the writes of both actors, in order (the reads of Claude are not asked about here).
    // create_token comes from the fixture, not from the demo.
    const reads = [
      "list_tickets_needing_us",
      "get_user_story",
      "get_ticket",
      "create_token",
    ];
    const journal = (
      (await (await send(app, alice.cookie, "GET", "/api/history")).json()) as {
        entries: {
          actor: string;
          origin: string;
          action: string;
          result: string;
        }[];
      }
    ).entries
      .filter((e) => !reads.includes(e.action))
      .reverse()
      .map((e) => [e.actor, e.origin, e.action, e.result]);
    expect(journal).toEqual([
      ["claude", "mcp", "create_user_stories", "ok"],
      ["human", "ui", "send_back_story", "ok"],
      ["claude", "mcp", "update_user_story", "ok"],
      ["human", "ui", "validate_story", "ok"],
      // The validated story is published as an issue right after (decision 020).
      ["system", "system", "sync_issue", "ok"],
      ["claude", "mcp", "validate_user_story", "refused"],
      ["claude", "mcp", "abandon_user_story", "refused"],
      ["claude", "mcp", "update_user_story", "refused"],
      ["human", "ui", "abandon_story", "ok"],
    ]);

    // 8. The page of the story tells the same, newest first, without the reads.
    const shown = (await (await storyHistory(app, alice.cookie, a)).json()) as {
      entries: { actor: string; action: string; result: string }[];
    };
    expect(shown.entries.map((e) => [e.actor, e.action, e.result])).toEqual([
      ["claude", "update_user_story", "refused"],
      ["system", "sync_issue", "ok"],
      ["human", "validate_story", "ok"],
      ["claude", "update_user_story", "ok"],
      ["human", "send_back_story", "ok"],
      ["claude", "create_user_stories", "ok"],
    ]);

    // Decision 010 D: no text of the stories, nor the comment, in the history.
    const text = await historyText(db);
    expect(text).not.toContain("ZQX");
    expect(text).not.toContain("réécrit");
    expect(text).not.toContain("vouloir-");
  });
});
