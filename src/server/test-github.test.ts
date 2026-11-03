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

  it("given an issue, when a label is added, then the answer is the whole label list of the issue, as GitHub's, not only the label added", async () => {
    const github = stubGitHub({ account: 1 });
    github.addLabel("o/r", "x");
    github.addLabel("o/r", "y");
    await call("POST", "/issues", { title: "t", body: "b", labels: ["x"] });

    const res = await call("POST", "/issues/1/labels", { labels: ["y"] });

    expect(await res.json()).toEqual([{ name: "x" }, { name: "y" }]);
  });

  it("given GitHub's limits, when an issue is created or patched with a title over 256 characters or a body over 65,536, then 422 and nothing changes; at the limit it is accepted", async () => {
    const github = stubGitHub({ account: 1 });
    const title = "t".repeat(256);
    const body = "b".repeat(65_536);
    expect(
      (await call("POST", "/issues", { title: `${title}t`, body: "b" })).status,
    ).toBe(422);
    expect(
      (await call("POST", "/issues", { title: "t", body: `${body}b` })).status,
    ).toBe(422);
    expect(github.issues("o/r")).toEqual([]);
    expect((await call("POST", "/issues", { title, body })).status).toBe(201);

    expect(
      (await call("PATCH", "/issues/1", { title: `${title}t` })).status,
    ).toBe(422);
    expect(
      (await call("PATCH", "/issues/1", { body: `${body}b` })).status,
    ).toBe(422);
    expect(github.issues("o/r")[0]).toMatchObject({ title, body });
  });

  it("given failOn, when a call matches it, then only that call fails with 500, until it is cleared", async () => {
    const github = stubGitHub({
      account: 1,
      failOn: (c) => c.method === "PATCH",
    });
    await call("POST", "/issues", { title: "t", body: "b" });

    expect((await call("PATCH", "/issues/1", { title: "u" })).status).toBe(500);
    expect(github.issues("o/r")[0]?.title).toBe("t");
    github.update({ failOn: undefined });
    expect((await call("PATCH", "/issues/1", { title: "u" })).status).toBe(200);
  });
});

describe("stubGitHub with a Git history (gitRepos, decision 026)", () => {
  const api = (method: string, path: string, body?: unknown) =>
    fetch(`https://api.github.com/repos/o/r${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("given a push after a commit was made, when the branch is moved to that commit without force, then 422 not a fast forward; with force it moves", async () => {
    const github = stubGitHub({
      account: 1,
      gitRepos: { "o/r": { files: { "a.txt": "a" } } },
    });
    const git = github.git("o/r");
    const base = git.head;
    const tree = (
      await (
        await api("POST", "/git/trees", {
          base_tree: git.commit(base)?.tree,
          tree: [{ path: "b.txt", mode: "100644", type: "blob", content: "b" }],
        })
      ).json()
    ).sha;
    const { sha } = await (
      await api("POST", "/git/commits", {
        message: "m",
        tree,
        parents: [base],
      })
    ).json();
    git.push({ "c.txt": "c" });

    const refused = await api("PATCH", "/git/refs/heads/main", {
      sha,
      force: false,
    });
    const forced = await api("PATCH", "/git/refs/heads/main", {
      sha,
      force: true,
    });

    expect(refused.status).toBe(422);
    expect(forced.status).toBe(200);
    expect(git.head).toBe(sha);
    expect(git.created.refUpdates.map((u) => u.force)).toEqual([false, true]);
  });

  it("given an empty repo, a missing file and a repo the App lost, when they are read, then 409 on the ref, 404 on the file and 404 on everything", async () => {
    const github = stubGitHub({
      account: 1,
      gitRepos: {
        "o/r": { files: { "a.txt": "a" } },
        "o/empty": { empty: true },
      },
    });
    const git = github.git("o/r");

    expect(
      (await fetch("https://api.github.com/repos/o/empty/git/ref/heads/main"))
        .status,
    ).toBe(409);
    expect(
      (await api("GET", `/contents/nope.txt?ref=${git.head}`)).status,
    ).toBe(404);
    expect((await api("GET", `/contents/a.txt?ref=${git.head}`)).status).toBe(
      200,
    );
    git.unreachable = true;
    expect((await api("GET", "")).status).toBe(404);
  });
});
