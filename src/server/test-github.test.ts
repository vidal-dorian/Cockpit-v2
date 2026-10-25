import { afterEach, describe, expect, it, vi } from "vitest";
import { failOnUnexpectedFetch, stubGitHub } from "./test-github.ts";

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

describe("failOnUnexpectedFetch", () => {
  it("given a test that records one unexpected call through the returned function, when the test finishes, then it fails naming the call", async ({
    onTestFinished,
  }) => {
    // Registered first, so it runs last (onTestFinished hooks run in reverse order): it sees the guard's error.
    // It rewrites the runner state (`task.result`) on purpose, to turn the expected failure into a pass once checked.
    onTestFinished(({ task }) => {
      const result = task.result;
      expect(result?.errors?.map((e) => e.message)).toEqual([
        expect.stringContaining("GET https://github.com/nope"),
      ]);
      if (result) {
        result.state = "pass";
        result.errors = undefined;
      }
    });
    const unexpectedFetch = failOnUnexpectedFetch();

    unexpectedFetch("GET https://github.com/nope");
  });

  it("given a test that records nothing, when the test finishes, then it passes", () => {
    failOnUnexpectedFetch();
  });

  it("given a call to record, when the returned function is called, then it returns an Error whose message is `Unexpected fetch <call>`", ({
    onTestFinished,
  }) => {
    // The recorded call fails the test on purpose (see the first test); this hook turns that expected failure into a pass.
    onTestFinished(({ task }) => {
      const result = task.result;
      expect(result?.errors?.map((e) => e.message)).toEqual([
        expect.stringContaining("POST https://github.com/nope"),
      ]);
      if (result) {
        result.state = "pass";
        result.errors = undefined;
      }
    });
    const unexpectedFetch = failOnUnexpectedFetch();

    const error = unexpectedFetch("POST https://github.com/nope");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Unexpected fetch POST https://github.com/nope");
  });
});
