import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import { stubGitHub } from "./test-github.ts";
import {
  BRANCH,
  type Ctx,
  FIRE_ANSWER,
  launch,
  ready,
} from "./test-launcher.ts";
import { callTool, dataOf } from "./test-mcp.ts";
import { memberWith } from "./test-members.ts";

// Story #45 (amends decision 060): only the launcher of a cloud run sees the address of its session.
// A read-only member who got it could use it to add messages to the session and inflate the cost.

afterEach(() => {
  vi.unstubAllGlobals();
});

const URL_OF_SESSION = FIRE_ANSWER.claude_code_session_url;

/** Alice launched a cloud run; Bob follows the project read-only. */
async function sharedCloudRun() {
  const ctx = await ready();
  const { launchId } = (await (await launch(ctx)).json()) as {
    launchId: number;
  };
  const { run_id } = dataOf<{ run_id: number }>(
    await callTool(ctx.app, ctx.alice.secret, "start_run", {
      story_id: ctx.storyId,
      branch: BRANCH,
      model: "claude-x",
      launch_id: launchId,
    }),
  );
  const bob = await memberWith(ctx, 2000, "read_only");
  return { ctx, runId: run_id, bob };
}

const readRun = async (ctx: Ctx, cookie: string, runId: number) => {
  const res = await send(ctx.app, cookie, "GET", `/api/runs/${runId}`);
  expect(res.status).toBe(200);
  return res.text();
};

describe("story #45: the session address of a run is the launcher's", () => {
  it("given a cloud run launched by A on a project shared with B read-only, when B calls GET /api/runs/:id, then the response does not contain sessionUrl", async () => {
    const { ctx, runId, bob } = await sharedCloudRun();

    const text = await readRun(ctx, bob.cookie, runId);

    expect(text).not.toContain("sessionUrl");
    expect(text).not.toContain(URL_OF_SESSION);
    expect(text).not.toContain("session_01ABCDEFGHIJ");
  });

  it("given the same run, when A calls GET /api/runs/:id, then the response contains sessionUrl", async () => {
    const { ctx, runId } = await sharedCloudRun();

    const body = JSON.parse(await readRun(ctx, ctx.alice.cookie, runId)) as {
      cloud: { sessionUrl: string } | null;
    };

    expect(body.cloud?.sessionUrl).toBe(URL_OF_SESSION);
  });

  it("given a workflow Claude was asked about by A, when B read-only lists the workflows, then the answer does not contain the session address", async () => {
    const ctx = await ready();
    const repo = "user1000/app";
    const path = ".github/workflows/nightly.yml";
    const fm = stubGitHub({
      account: 1000,
      gitRepos: {
        [repo]: {
          files: { "README.md": "# app\n", [path]: "name: N\non: push\n" },
        },
      },
    });
    fm.git(repo).workflows.push({
      path,
      name: "Nightly",
      runs: [
        { conclusion: "failure", seconds: 60, at: "2026-11-08T09:00:00Z" },
      ],
    });
    const asked = await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/projects/${ctx.projectId}/workflows/ask`,
      { path },
    );
    expect(asked.status).toBe(201);
    const bob = await memberWith(ctx, 2000, "read_only");

    const res = await send(
      ctx.app,
      bob.cookie,
      "GET",
      `/api/projects/${ctx.projectId}/workflows`,
    );

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(URL_OF_SESSION);
  });
});
