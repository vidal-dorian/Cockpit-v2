import { afterEach, describe, expect, it, vi } from "vitest";
import { send, withStory } from "./test-decisions.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Decision 020 D: a story that reaches GitHub late (its first sync failed, or it moved on) is created closed.
describe("publishing a story that is already done", () => {
  it("given a done story without issue, when it is published, then the issue is created and closed as completed", async () => {
    const s = await withStory("done");

    const res = await send(
      s.app,
      s.alice.cookie,
      "POST",
      `/api/stories/${s.id}/publish`,
    );

    expect(res.status).toBe(200);
    const [issue] = s.fetchMock.issues("user1000/app");
    expect(issue).toMatchObject({
      state: "closed",
      stateReason: "completed",
      labels: ["cockpit: terminée"],
    });
  });
});
