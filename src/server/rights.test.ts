// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { afterEach, describe, expect, it, vi } from "vitest";
import { running } from "./test-criteria.ts";
import {
  abandonStory,
  editBody,
  editStory,
  entryCount,
  send,
  sendBack,
  snapshot,
  validate,
  withStory,
} from "./test-decisions.ts";
import {
  callTool,
  dataOf,
  expectRefused,
  listedTools,
  mcpRows,
  rows,
  seedStory,
  seedTicket,
  storyCounts,
} from "./test-mcp.ts";
import { memberWith, ROLES, type Role } from "./test-members.ts";

// Slice 4.4 (decision 018 G): the table of rights of decision 004, one test per row that exists at this slice, on both
// sides. The table is kept by what does not exist: Claude's side is an invented tool that the server does not know (a
// refusal `unknown_tool`, journaled, the story unchanged) or a tool that refuses; the human's side is a route that
// works, or one that answers 404 or 409. The rows of the runs (ready -> in_progress and the like) and of GitHub
// (webhooks) get their tests with their slices (7.x, 5.x).
//
// A test of a row whose human side is "yes" also proves that the route exists, so it fails until the slice is built.
// The row "create" and the "no route" checks are guards: they hold today and must keep holding.

type Ctx = Awaited<ReturnType<typeof withStory>>;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Claude calls tools that do not exist: each is refused and journaled under its own name, and the story is left as it was. */
async function claudeHasNoTool(ctx: Ctx, tools: string[], storyId: number) {
  const before = await snapshot(ctx.db, storyId);
  const entriesBefore = (await mcpRows(ctx.db)).length;
  for (const tool of tools) {
    const text = expectRefused(
      await callTool(ctx.app, ctx.alice.secret, tool, {
        story_id: storyId,
        ticket_id: ctx.ticketId,
        comment: "non",
      }),
    );
    expect(text, tool).toMatch(/unknown tool/i);
  }
  const entries = (await mcpRows(ctx.db)).slice(entriesBefore);
  expect(
    entries.map((e) => [e.actor, e.origin, e.action, e.result, e.detail]),
  ).toEqual(
    tools.map((tool) => [
      "claude",
      "mcp",
      tool,
      "refused",
      { reason: "unknown_tool" },
    ]),
  );
  expect(await snapshot(ctx.db, storyId)).toEqual(before);
  const listed = (await listedTools(ctx.app, ctx.alice.secret)).map(
    (t) => t.name,
  );
  for (const tool of tools) expect(listed).not.toContain(tool);
}

/** The routes a human has not been given answer 404 or 405, and write nothing. */
async function noSuchRoute(
  ctx: Ctx,
  routes: [method: string, path: string][],
  body: unknown = undefined,
) {
  const stories = await storyCounts(ctx.db);
  const entries = await entryCount(ctx.db);
  for (const [method, path] of routes) {
    const res = await send(ctx.app, ctx.alice.cookie, method, path, body);
    expect([404, 405], `${method} ${path}`).toContain(res.status);
  }
  expect(await storyCounts(ctx.db)).toEqual(stories);
  expect(await entryCount(ctx.db)).toBe(entries);
}

describe("rights: create -> to_validate (Claude: create_user_stories; human: no)", () => {
  it("given a ticket, when Claude creates stories, then they are to_validate; and no route lets the human create a story", async () => {
    const s = await withStory("to_validate");
    const ticketId = await seedTicket(s.db, s.projectId, "Neuf");

    const created = dataOf<{ stories: { id: number }[] }>(
      await callTool(s.app, s.alice.secret, "create_user_stories", {
        ticket_id: ticketId,
        stories: [
          {
            as_a: "rôle",
            i_want: "vouloir",
            so_that: "but",
            criteria: [{ given: "g", when: "w", then: "t" }],
          },
        ],
      }),
    );
    expect(
      (await snapshot(s.db, created.stories[0]?.id as number)).status,
    ).toBe("to_validate");

    const story = {
      asA: "rôle",
      iWant: "vouloir",
      soThat: "but",
      criteria: [{ given: "g", when: "w", then: "t" }],
    };
    await noSuchRoute(
      s,
      [
        ["POST", `/api/tickets/${s.ticketId}/stories`],
        ["PUT", `/api/tickets/${s.ticketId}/stories`],
        ["POST", `/api/projects/${s.projectId}/stories`],
        ["POST", "/api/stories"],
        ["PUT", `/api/stories/${s.id}`],
        ["PUT", "/api/stories/424242"],
        ["PATCH", "/api/stories/424242"],
      ],
      story,
    );
  });
});

describe("rights: to_validate -> ready (Claude: never; human: yes)", () => {
  it("given a to_validate story, when Claude tries to validate it, then it is refused as an unknown tool and nothing changes; the human validates it", async () => {
    const s = await withStory("to_validate");

    await claudeHasNoTool(
      s,
      ["validate_user_story", "approve_user_story", "update_status"],
      s.id,
    );

    const res = await validate(s.app, s.alice.cookie, s.id);
    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).status).toBe("ready");
  });
});

describe("rights: to_validate -> to_rewrite (Claude: never; human: yes, with a comment)", () => {
  it("given a to_validate story, when Claude tries to send it back, then it is refused as an unknown tool and nothing changes; the human sends it back with a comment and not without", async () => {
    const s = await withStory("to_validate");

    await claudeHasNoTool(
      s,
      ["send_back_user_story", "reject_user_story"],
      s.id,
    );

    expect((await sendBack(s.app, s.alice.cookie, s.id, {})).status).toBe(400);
    expect((await snapshot(s.db, s.id)).status).toBe("to_validate");
    const res = await sendBack(s.app, s.alice.cookie, s.id, {
      comment: "Précise",
    });
    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).status).toBe("to_rewrite");
  });
});

describe("rights: to_rewrite -> to_validate (Claude: update_user_story; human: no)", () => {
  it("given a to_rewrite story, when Claude rewrites it, then it is to_validate; but Claude cannot edit a story that is not to_rewrite", async () => {
    const s = await withStory("to_rewrite", { rewriteComment: "Précise" });
    const other = {
      ...s,
      id: await seedStory(s.db, s.ticketId, { status: "to_validate" }),
    };

    dataOf(
      await callTool(s.app, s.alice.secret, "update_user_story", {
        story_id: s.id,
        as_a: "rôle",
        i_want: "vouloir",
        so_that: "but",
        criteria: [{ given: "g", when: "w", then: "t" }],
      }),
    );
    expect((await snapshot(s.db, s.id)).status).toBe("to_validate");

    const before = await snapshot(other.db, other.id);
    expectRefused(
      await callTool(other.app, other.alice.secret, "update_user_story", {
        story_id: other.id,
        as_a: "rôle",
        i_want: "vouloir",
        so_that: "but",
        criteria: [{ given: "g", when: "w", then: "t" }],
      }),
    );
    expect(await snapshot(other.db, other.id)).toEqual(before);
  });

  it("given a to_rewrite story, when the human edits it, even asking for another status, then the text changes but the story stays to_rewrite; and no route rewrites it in Claude's place", async () => {
    const s = await withStory("to_rewrite", { rewriteComment: "Précise" });

    const res = await send(
      s.app,
      s.alice.cookie,
      "PATCH",
      `/api/stories/${s.id}`,
      {
        ...editBody(1),
        status: "to_validate",
      },
    );

    // The status is no field of the body: it is ignored (200) or refused (400, a strict body), never applied.
    expect([200, 400]).toContain(res.status);
    expect(await snapshot(s.db, s.id)).toMatchObject({
      status: "to_rewrite",
      rewriteComment: "Précise",
    });
    await noSuchRoute(s, [
      ["POST", `/api/stories/${s.id}/rewrite`],
      ["POST", `/api/stories/${s.id}/resubmit`],
    ]);
  });

  it.each(["ready", "to_validate"] as const)(
    "given a %s story, when the human edits it asking for another status, then the status never changes",
    async (status) => {
      const s = await withStory(status);

      const res = await send(
        s.app,
        s.alice.cookie,
        "PATCH",
        `/api/stories/${s.id}`,
        { ...editBody(2), status: "in_progress" },
      );

      expect([200, 400]).toContain(res.status);
      expect((await snapshot(s.db, s.id)).status).toBe(status);
    },
  );
});

describe("rights: any state -> abandoned (Claude: never; human: yes)", () => {
  it("given a ready story and its ticket, when Claude tries to abandon or delete them, then it is refused as an unknown tool and nothing changes; the human abandons the story", async () => {
    const s = await withStory("ready");

    await claudeHasNoTool(
      s,
      [
        "abandon_user_story",
        "abandon_ticket",
        "delete_ticket",
        "delete_user_story",
      ],
      s.id,
    );

    const res = await abandonStory(s.app, s.alice.cookie, s.id);
    expect(res.status).toBe(200);
    expect((await snapshot(s.db, s.id)).status).toBe("abandoned");
  });
});

describe("rights: in_review -> done and in_review -> ready (Claude: never; human: never; GitHub only)", () => {
  it("given an in_review story, when Claude tries to finish it, then it is refused as an unknown tool; the human cannot make it done either: validating, sending back or editing it is refused and it stays in_review", async () => {
    const s = await withStory("in_review");

    await claudeHasNoTool(
      s,
      [
        "complete_user_story",
        "finish_user_story",
        "merge_pull_request",
        "reopen_user_story",
      ],
      s.id,
    );

    expect((await validate(s.app, s.alice.cookie, s.id)).status).toBe(409);
    expect(
      (await sendBack(s.app, s.alice.cookie, s.id, { comment: "non" })).status,
    ).toBe(409);
    // Refused because in_review is not editable (409), or because "status" is no field (400).
    expect([400, 409]).toContain(
      (
        await editStory(s.app, s.alice.cookie, s.id, {
          ...editBody(3),
          status: "done",
        })
      ).status,
    );
    expect((await snapshot(s.db, s.id)).status).toBe("in_review");
    await noSuchRoute(s, [
      ["POST", `/api/stories/${s.id}/done`],
      ["POST", `/api/stories/${s.id}/complete`],
      ["POST", `/api/stories/${s.id}/reopen`],
    ]);
  });
});

// Slice 13.1 (decision 076 A, 064 13.1 A): the same table with one column per role, one test per row (a gesture of the
// human). Each role below the minimum is refused 403 { error: "role" } and journaled `refused` { reason: "role" }; each
// role from the minimum up gets anything but that refusal (a 409 of the story's status is not a refusal of the role).
// `refuseOnly` rows reach GitHub when they work, so only the refusals are checked.

const ROW_BODY = {
  comment: "Précise",
  title: "Une idée",
  favorite: true,
};

type Row = {
  min: Role;
  call: (
    s: Awaited<ReturnType<typeof running>>,
    cookie: string,
  ) => Response | Promise<Response>;
  refuseOnly?: boolean;
};

const ROWS: Record<string, Row> = {
  "read a story": {
    min: "read_only",
    call: (s, c) => send(s.app, c, "GET", `/api/stories/${s.id}`),
  },
  "read the tickets": {
    min: "read_only",
    call: (s, c) =>
      send(s.app, c, "GET", `/api/projects/${s.projectId}/tickets`),
  },
  "star the project": {
    min: "read_only",
    call: (s, c) =>
      send(s.app, c, "PUT", `/api/projects/${s.projectId}/favorite`, {
        favorite: ROW_BODY.favorite,
      }),
  },
  "validate a story": {
    min: "can_validate",
    call: (s, c) => validate(s.app, c, s.id),
  },
  "send a story back": {
    min: "can_validate",
    call: (s, c) => sendBack(s.app, c, s.id, { comment: ROW_BODY.comment }),
  },
  "edit a story": {
    min: "can_validate",
    call: (s, c) => editStory(s.app, c, s.id, editBody(1)),
  },
  "abandon a story": {
    min: "can_validate",
    call: (s, c) => abandonStory(s.app, c, s.id),
  },
  "note an idea": {
    min: "can_validate",
    call: (s, c) =>
      send(s.app, c, "POST", `/api/projects/${s.projectId}/tickets`, {
        title: ROW_BODY.title,
      }),
  },
  "abandon a ticket": {
    min: "can_validate",
    call: (s, c) =>
      send(s.app, c, "POST", `/api/tickets/${s.ticketId}/abandon`),
  },
  "stop a run": {
    min: "can_launch",
    call: (s, c) => send(s.app, c, "POST", `/api/runs/${s.runId}/stop`),
  },
  "close a run": {
    min: "can_launch",
    call: (s, c) => send(s.app, c, "POST", `/api/runs/${s.runId}/close`),
  },
  "queue a story": {
    min: "can_launch",
    call: (s, c) => send(s.app, c, "POST", "/api/queue", { storyId: s.base }),
  },
  "archive the project": {
    min: "owner",
    call: (s, c) =>
      send(s.app, c, "POST", `/api/projects/${s.projectId}/archive`),
  },
  "prepare the repo for Claude": {
    min: "owner",
    refuseOnly: true,
    call: (s, c) =>
      send(s.app, c, "POST", `/api/projects/${s.projectId}/prepare`),
  },
};

describe("rights by role (076 A): one column per role", () => {
  it.each(Object.entries(ROWS))(
    "given each role, when the human tries to %s, then only the roles from the minimum up are let in",
    async (_name, row) => {
      const s = await running();
      const cookies: Record<Role, string> = {
        read_only: (await memberWith(s, 2001, "read_only")).cookie,
        can_validate: (await memberWith(s, 2002, "can_validate")).cookie,
        can_launch: (await memberWith(s, 2003, "can_launch")).cookie,
        owner: s.alice.cookie,
      };
      const below = ROLES.filter(
        (r) => ROLES.indexOf(r) < ROLES.indexOf(row.min),
      );

      for (const role of below) {
        const res = await row.call(s, cookies[role]);
        expect([role, res.status, await res.json()]).toEqual([
          role,
          403,
          { error: "role" },
        ]);
      }
      if (!row.refuseOnly)
        for (const role of ROLES.filter((r) => !below.includes(r))) {
          const res = await row.call(s, cookies[role]);
          expect([
            role,
            res.status === 403 &&
              ((await res.json()) as { error?: string }).error === "role",
          ]).toEqual([role, false]);
        }
      const refused = (await rows(s.db)).filter(
        (r) => r.result === "refused" && r.detail?.reason === "role",
      );
      expect(refused).toHaveLength(below.length);
      for (const entry of refused) expect(entry.project_id).toBe(s.projectId);
    },
  );
});
