import { afterEach, describe, expect, it, vi } from "vitest";
import { withStory } from "./test-decisions.ts";
import { callTool, mcpRows, type ToolResult, textOf } from "./test-mcp.ts";
import { memberWith, ROLES, type Role } from "./test-members.ts";

// Slice 13.1 (decision 076 B): Claude acts for the user of the token, so a tool that writes asks the role of the matching
// human gesture. A role below the minimum gets the tool result "Refused: role", journaled claude / mcp / <tool> `refused`
// with detail { reason: "role" } on the project; from the minimum up the call is not refused for the role.
// `refuseOnly` rows reach GitHub when they work, so only the refusals are checked.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof withStory>>;
const TOOLS: Record<
  string,
  { min: Role; args: (s: Ctx) => unknown; refuseOnly?: boolean }
> = {
  list_projects: { min: "read_only", args: () => ({}) },
  get_project: {
    min: "read_only",
    args: (s) => ({ project_id: s.projectId }),
  },
  create_ticket: {
    min: "can_validate",
    args: (s) => ({ project_id: s.projectId, title: "Une idée" }),
  },
  start_run: {
    min: "can_launch",
    args: (s) => ({ story_id: s.base, branch: "us/1-x", model: "claude-x" }),
  },
  propose_workflow_change: {
    min: "owner",
    refuseOnly: true,
    args: (s) => ({
      project_id: s.projectId,
      path: ".github/workflows/ci.yml",
      content: "on: push\n",
      reason: "Run the tests.",
    }),
  },
};

const refusedForRole = (r: ToolResult) =>
  r.isError === true && /role/.test(textOf(r)) && /^Refused:/.test(textOf(r));

describe("MCP tools by role (076 B)", () => {
  it.each(Object.entries(TOOLS))(
    "given each role, when Claude calls %s for its user, then only the roles from the minimum up are let in",
    async (tool, row) => {
      const s = await withStory("ready");
      const secrets: Record<Role, string> = {
        read_only: (await memberWith(s, 2001, "read_only")).secret,
        can_validate: (await memberWith(s, 2002, "can_validate")).secret,
        can_launch: (await memberWith(s, 2003, "can_launch")).secret,
        owner: s.alice.secret,
      };
      const below = ROLES.filter(
        (r) => ROLES.indexOf(r) < ROLES.indexOf(row.min),
      );

      for (const role of below)
        expect(
          refusedForRole(
            await callTool(s.app, secrets[role], tool, row.args(s)),
          ),
          role,
        ).toBe(true);
      if (!row.refuseOnly)
        for (const role of ROLES.filter((r) => !below.includes(r)))
          expect(
            refusedForRole(
              await callTool(s.app, secrets[role], tool, row.args(s)),
            ),
            role,
          ).toBe(false);

      const refused = (await mcpRows(s.db)).filter(
        (r) => r.result === "refused" && r.detail?.reason === "role",
      );
      expect(refused).toHaveLength(below.length);
      for (const entry of refused)
        expect([entry.actor, entry.origin, entry.action]).toEqual([
          "claude",
          "mcp",
          tool,
        ]);
    },
  );
});
