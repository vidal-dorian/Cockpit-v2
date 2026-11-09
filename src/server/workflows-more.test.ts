import { afterEach, describe, expect, it, vi } from "vitest";
import { ALERT_PERMISSIONS, BASE_PERMISSIONS } from "./test-github.ts";
import { withProject } from "./test-mcp.ts";
import { summarize } from "./workflows.ts";

// Slice 12.4 review: the conclusions that count (decision 067 B) and the App that lacks `workflows` (decision 067 D).

afterEach(() => {
  vi.unstubAllGlobals();
});

const run = (conclusion: string | null) => ({
  conclusion,
  event: "push",
  created_at: "2026-11-08T10:00:00Z",
  updated_at: "2026-11-08T10:01:00Z",
  html_url: "https://github.com/o/r/actions/runs/1",
});
const summary = (...conclusions: (string | null)[]) =>
  summarize([{ path: "p", name: "n", runs: conclusions.map(run) }])[0];

describe("summarize", () => {
  it.each([
    [
      "a run in progress is ignored",
      [null, "failure", "success"],
      1,
      "failure",
    ],
    [
      "a cancelled run is ignored",
      ["cancelled", "failure", "failure"],
      2,
      "failure",
    ],
    ["a skipped run is ignored", ["skipped", "success"], 0, "success"],
    ["timed_out is red", ["timed_out", "success"], 1, "timed_out"],
    [
      "startup_failure is red",
      ["startup_failure", "success"],
      1,
      "startup_failure",
    ],
  ])("%s", (_name, conclusions, failingSince, conclusion) => {
    expect(summary(...conclusions)).toMatchObject({
      failingSince,
      lastRun: { conclusion },
    });
  });
});

describe("decision 067 D: an App without the permission", () => {
  it("given an App that lacks workflows, when the workflows are read, then the link is the App's permissions page and appMissing is true", async () => {
    const ctx = await withProject({
      appInfo: {
        permissions: {
          ...BASE_PERMISSIONS,
          ...ALERT_PERMISSIONS,
          workflows: "read",
        },
      },
      gitRepos: { "user1000/app": { files: { "README.md": "x\n" } } },
    });

    const res = await ctx.app.request(
      `/api/projects/${ctx.projectId}/workflows`,
      {
        headers: { cookie: ctx.alice.cookie },
      },
    );

    expect(((await res.json()) as { permission: unknown }).permission).toEqual({
      workflows: false,
      installationUrl:
        "https://github.com/settings/apps/cockpit-test/permissions",
      appMissing: true,
    });
  });
});
