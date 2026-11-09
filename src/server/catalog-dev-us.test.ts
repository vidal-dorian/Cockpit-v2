import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Slice 7.1 (decision 033 K): /dev-us reports its run to Cockpit.

const SKILL = fileURLToPath(
  new URL("../../catalog/skills/dev-us/SKILL.md", import.meta.url),
);

describe("criterion 11: catalog/skills/dev-us/SKILL.md", () => {
  it.each(["start_run", "report_step", "finish_run"])(
    "given the skill dev-us, when it is read, then it names the tool %s",
    (tool) => {
      expect(readFileSync(SKILL, "utf8")).toContain(tool);
    },
  );
});

describe("criterion 13 (slice 7.2, decision 034 I): the extra prompt", () => {
  it("given the skill dev-us, when it is read, then it tells to pass the extra prompt to start_run as `comment`", () => {
    const text = readFileSync(SKILL, "utf8");
    const start = text.slice(
      text.indexOf("## Start the run"),
      text.indexOf("## Develop"),
    );
    expect(start).toMatch(/`comment`/);
    expect(start).toMatch(/extra prompt/);
  });
});

describe("criterion 11 (slice 7.3, decision 035 H): criteria and pull request", () => {
  it.each(["report_criterion", "link_pull_request"])(
    "given the skill dev-us, when it is read, then it names the tool %s in its Finish section, before finish_run",
    (tool) => {
      const text = readFileSync(SKILL, "utf8");
      const finish = text.slice(
        text.indexOf("## Finish"),
        text.indexOf("## Never"),
      );
      expect(finish).toContain(tool);
      expect(finish.indexOf(tool)).toBeLessThan(finish.indexOf("finish_run"));
    },
  );
});

describe("criterion 9 (slice 7.4, decision 036 I): the questions", () => {
  it.each(["ask_user", "get_answer"])(
    "given the skill dev-us, when it is read, then it names the tool %s",
    (tool) => {
      expect(readFileSync(SKILL, "utf8")).toContain(tool);
    },
  );

  it.each([/30 seconds/i, /5 minutes/i])(
    "given the skill dev-us, when it is read, then it states the waits (%s)",
    (wait) => {
      expect(readFileSync(SKILL, "utf8")).toMatch(wait);
    },
  );
});

describe("criterion 10 (slice 7.5, decision 037 H): stopping and relaunching", () => {
  it("given the skill dev-us, when it is read, then it names stop_requested and says to call finish_run failed when it is true", () => {
    const text = readFileSync(SKILL, "utf8");
    expect(text).toContain("stop_requested");
    expect(text).toMatch(/stop_requested[\s\S]*finish_run[\s\S]*failed/);
  });

  it("given the skill dev-us, when it is read, then it says that an in_review story reuses its PR with link_pull_request instead of opening a new one", () => {
    const text = readFileSync(SKILL, "utf8");
    expect(text).toContain("in_review");
    expect(text).toMatch(/in_review[\s\S]*pr_number/);
    expect(text).toMatch(/in_review[\s\S]*link_pull_request/);
  });
});

describe("slice 9.5 (decision 069 F): the steps and the context", () => {
  it("given the skill dev-us, when it is read, then start_run gets the `steps` (the freeze ones too) and ask_user a `context`", () => {
    const text = readFileSync(SKILL, "utf8");
    const start = text.slice(
      text.indexOf("## Start the run"),
      text.indexOf("## Develop"),
    );
    expect(start).toMatch(/`steps`/);
    expect(text).toMatch(/freeze run the `steps` are the two freeze steps/);
    expect(text).toMatch(/`mcp__cockpit__ask_user`[^.]*`context`/);
  });
});

describe("slice E6 (decision 079 B): groups and limits in /dev-us", () => {
  const text = readFileSync(SKILL, "utf8");
  const develop = text.slice(
    text.indexOf("## Develop"),
    text.indexOf("## At night"),
  );

  it.each([
    ["parallel", /`parallel: true`/],
    ["at the same time, by sub-agents", /same time[\s\S]*sub-agent/i],
    ["each in its own git worktree", /own git worktree/i],
    [
      "merged into the story branch",
      /merge[\s\S]*branch of the story|story branch/i,
    ],
    ["wait: first", /`wait: first`/],
    [
      "the first finished branch merged, the others abandoned",
      /first[\s\S]*(abandon|discard)/i,
    ],
    ["a merge conflict asks the user", /conflict[\s\S]*`?ask_user`?/i],
    ["max", /`max`/],
    ["at the limit, stop and ask", /limit[\s\S]*ask_user/i],
    [
      "until: always follows the loop exactly max times",
      /`until: always`|always[\s\S]*exactly/i,
    ],
    ["id is the key that loop_to names", /`id`[\s\S]*`loop_to`/],
    ["a loop into a step of a group redoes only that step", /only that step/i],
  ])(
    "given the skill dev-us, when its Develop section is read, then it explains %s",
    (_n, pattern) => {
      expect(develop).toMatch(pattern);
    },
  );

  it("given the skill dev-us, when its Develop section is read, then it says always follows the loop exactly `max` times", () => {
    expect(develop).toMatch(
      /always[^.]*exactly[^.]*`max`|exactly[^.]*`max`[^.]*always/is,
    );
  });
});
