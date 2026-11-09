import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withProject } from "./test-mcp.ts";
import { memberWith } from "./test-members.ts";

// Slice 13.1 (decision 076 A, J): the migration drops the one-member index and widens `role`, written with raw SQL.
// Pinned: the table `project_invitations` and the column `users.last_login_at` exist (columns in test-members.ts).

afterEach(() => {
  vi.unstubAllGlobals();
});

const refused = async (query: Promise<unknown>) => {
  const error = await query.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "the insert must be refused").not.toBeNull();
};

describe("076 A: several members and four roles per project", () => {
  it.each(["read_only", "can_validate", "can_launch"] as const)(
    "given a project with its owner, when a second member joins as %s, then the row is kept",
    async (role) => {
      const ctx = await withProject();

      await memberWith(ctx, 2000, role);

      const found = await ctx.db.execute(
        sql`select role from project_members where project_id = ${ctx.projectId} order by role`,
      );
      expect(
        (found as unknown as { rows: { role: string }[] }).rows.map(
          (r) => r.role,
        ),
      ).toContain(role);
    },
  );

  it("given a project with its owner, when a role outside the four or a second owner is inserted, then both are refused", async () => {
    const ctx = await withProject();
    const bob = await memberWith(ctx, 2000, "read_only");
    const carol = await memberWith(ctx, 3000, "read_only");

    await refused(
      ctx.db.execute(
        sql`update project_members set role = 'admin' where user_id = ${bob.id}`,
      ),
    );
    await refused(
      ctx.db.execute(
        sql`update project_members set role = 'owner' where user_id = ${carol.id}`,
      ),
    );
  });
});
