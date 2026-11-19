import { afterEach, describe, expect, it, vi } from "vitest";
import {
  finishLaunched,
  nightCall,
  planned,
  ready,
  started,
} from "./test-launcher.ts";

// Decision 085 C (slice S05): an item of the current night carries the id of its run, so /nuit links to it.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Current = {
  night: null | { items: { storyId: number; runId?: number | null }[] };
};
const current = async (ctx: Awaited<ReturnType<typeof ready>>) =>
  (await (await nightCall(ctx, "GET", "/current")).json()) as Current;

describe("decision 085 C: the run of a night item", () => {
  it("given a night started with a first run, when the night is read, then the first item has its runId and the next one null", async () => {
    const ctx = await ready();
    const [first, second] = await started(ctx, 2);
    const runId = await finishLaunched(ctx, null);

    const { night } = await current(ctx);

    expect(night?.items.find((i) => i.storyId === first)?.runId).toBe(runId);
    expect(night?.items.find((i) => i.storyId === second)?.runId).toBeNull();
  });

  it("given a planned night, when it is read, then every item has a null runId", async () => {
    const ctx = await ready();
    await planned(ctx, 2);

    const { night } = await current(ctx);

    expect(night?.items.map((i) => i.runId)).toEqual([null, null]);
  });
});
