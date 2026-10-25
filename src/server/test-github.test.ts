import { afterEach, describe, expect, it, vi } from "vitest";
import { stubGitHub } from "./test-github.ts";

afterEach(() => vi.unstubAllGlobals());

describe("stubGitHub", () => {
  it("given a call the stub does not serve and a swallowed rejection, when the test finishes, then it fails naming the call", async ({
    onTestFinished,
  }) => {
    // Registered first, so it runs last (onTestFinished hooks run in reverse order): it sees the guard's error.
    // It rewrites the runner state (`task.result`) on purpose, to turn the expected failure into a pass once checked.
    onTestFinished(({ task }) => {
      const result = task.result;
      expect(result?.errors?.map((e) => e.message)).toEqual([
        expect.stringContaining("GET https://api.github.com/nope"),
      ]);
      if (result) {
        result.state = "pass";
        result.errors = undefined;
      }
    });
    stubGitHub({ account: 1 });

    await fetch("https://api.github.com/nope").catch(() => {});
  });

  it("given only calls the stub serves, when the test finishes, then it passes", async () => {
    stubGitHub({ account: 1 });

    const response = await fetch("https://api.github.com/users/x/installation");

    expect(response.status).toBe(200);
  });
});
