import { afterEach, describe, expect, it, vi } from "vitest";
import { send, withStory } from "./test-decisions.ts";
import { archiveProject } from "./test-mcp.ts";

// Slice 4.4 (decision 018 J): what the page of a story needs from GET /api/stories/:id to offer the decisions.
// Pinned: story.rewriteComment (string | null) and project.archived (boolean).

afterEach(() => {
  vi.unstubAllGlobals();
});

type Read = {
  story: { rewriteComment?: string | null };
  project: { id: number; fullName: string; archived?: boolean };
};
const read = async (s: Awaited<ReturnType<typeof withStory>>) =>
  (await (
    await send(s.app, s.alice.cookie, "GET", `/api/stories/${s.id}`)
  ).json()) as Read;

describe("GET /api/stories/:id for the decisions of slice 4.4", () => {
  it("given a story sent back with a comment, when it is read, then rewriteComment is the comment; a story never sent back has null", async () => {
    const sentBack = await withStory("to_rewrite", {
      rewriteComment: "Précise le cas vide",
    });
    const fresh = await withStory("to_validate");

    expect((await read(sentBack)).story.rewriteComment).toBe(
      "Précise le cas vide",
    );
    expect((await read(fresh)).story.rewriteComment).toBeNull();
  });

  it("given an active and an archived project, when a story is read, then project.archived says false then true", async () => {
    const s = await withStory("to_validate");
    expect((await read(s)).project).toEqual({
      id: s.projectId,
      fullName: "user1000/app",
      defaultBranch: "main",
      archived: false,
    });

    await archiveProject(s.db, s.projectId);

    expect((await read(s)).project.archived).toBe(true);
  });
});
