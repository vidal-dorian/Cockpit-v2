import { afterEach, describe, expect, it, vi } from "vitest";
import {
  failOnUnexpectedFetch,
  issueCalls,
  stubGitHub,
} from "./test-github.ts";

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

describe("stubGitHub issues (slice 4.6)", () => {
  const api = "https://api.github.com/repos/o/r";
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${api}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("given a label that does not exist, when an issue is created with it or it is added to an issue, then 422 until the label is created, and creating it twice is 422", async () => {
    const github = stubGitHub({ account: 1 });
    expect(
      (await call("POST", "/issues", { title: "t", body: "b", labels: ["x"] }))
        .status,
    ).toBe(422);
    expect(
      (await call("POST", "/issues", { title: "t", body: "b" })).status,
    ).toBe(201);
    expect(
      (await call("POST", "/issues/1/labels", { labels: ["x"] })).status,
    ).toBe(422);

    expect((await call("POST", "/labels", { name: "x" })).status).toBe(201);
    expect((await call("POST", "/labels", { name: "x" })).status).toBe(422);
    expect(
      (await call("POST", "/issues/1/labels", { labels: ["x"] })).status,
    ).toBe(200);

    expect(github.issues("o/r")[0]?.labels).toEqual(["x"]);
  });

  it("given an issue with a label, when it is patched, closed and a label removed, then the fake holds the new state and a missing label or issue is 404", async () => {
    const github = stubGitHub({ account: 1 });
    github.addLabel("o/r", "x");
    const created = await call("POST", "/issues", {
      title: "t",
      body: "b",
      labels: ["x"],
    });
    expect(await created.json()).toMatchObject({
      number: 1,
      html_url: "https://github.com/o/r/issues/1",
    });

    await call("PATCH", "/issues/1", {
      title: "t2",
      body: "b2",
      state: "closed",
      state_reason: "not_planned",
    });
    expect(github.issues("o/r")[0]).toMatchObject({
      title: "t2",
      body: "b2",
      state: "closed",
      stateReason: "not_planned",
      labels: ["x"],
    });
    expect((await call("DELETE", "/issues/1/labels/x")).status).toBe(200);
    expect((await call("DELETE", "/issues/1/labels/x")).status).toBe(404);
    expect((await call("PATCH", "/issues/9", { title: "z" })).status).toBe(404);
  });

  it("given issuesStatus, when an issue call is made, then it fails with that status, and issueCalls lists only the issue and label calls", async () => {
    const github = stubGitHub({ account: 1, issuesStatus: 500 });
    expect((await call("POST", "/labels", { name: "x" })).status).toBe(500);
    github.update({ issuesStatus: undefined });
    expect((await call("POST", "/labels", { name: "x" })).status).toBe(201);
    await fetch("https://api.github.com/users/x/installation");

    expect(issueCalls(github).map((c) => [c.method, c.path])).toEqual([
      ["POST", "/repos/o/r/labels"],
      ["POST", "/repos/o/r/labels"],
    ]);
  });
});
