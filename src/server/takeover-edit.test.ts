// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { afterEach, describe, expect, it, vi } from "vitest";
import { editStory, send } from "./test-decisions.ts";
import { sourceRows, withRules } from "./test-takeover.ts";

// Decision 047: the edit of a story replaces its criteria, which would silently drop the sources and the state of a rule.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decision 047: editing a takeover story", () => {
  it("given a takeover story, when a member edits it, then 409 takeover_story and the rules and their sources are untouched", async () => {
    const ctx = await withRules();
    const sources = await sourceRows(ctx.db);

    const res = await editStory(
      ctx.app,
      ctx.alice.cookie,
      ctx.stories[0]?.id as number,
      {
        asA: "a",
        iWant: "b",
        soThat: "c",
        criteria: [{ given: "g", when: "w", then: "t" }],
      },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "takeover_story" });
    expect(await sourceRows(ctx.db)).toEqual(sources);
    const story = await send(
      ctx.app,
      ctx.alice.cookie,
      "GET",
      `/api/stories/${ctx.stories[0]?.id}`,
    );
    const { story: read } = (await story.json()) as {
      story: { criteria: unknown[] };
    };
    expect(read.criteria).toHaveLength(2);
  });
});
