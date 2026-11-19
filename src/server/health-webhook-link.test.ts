import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { projectMembers, projects, sessions, users } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  DEFAULT_WEBHOOK_URL,
  INSTALLATION_ID,
  stubGitHub,
} from "./test-github.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Decision 085 D, S08: a red webhook line carries `url`, the settings of the App on GitHub, where it is fixed
// (the same page as `appSettingsUrl`); a green line carries none.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Line = { key: string; ok: boolean; detail: string; url?: string };

async function webhookLine(
  webhook: Parameters<typeof stubGitHub>[0]["webhook"],
) {
  stubGitHub({ account: 1000, files: {}, webhook });
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", testAppOptions);
  const [user] = await db
    .insert(users)
    .values({ githubId: 1000, login: "user1000" })
    .returning({ id: users.id });
  assert(user);
  await db.insert(sessions).values({
    id: createHash("sha256").update("cookie-of-1000").digest("hex"),
    userId: user.id,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const [project] = await db
    .insert(projects)
    .values({
      githubRepoId: 1,
      fullName: "user1000/a",
      defaultBranch: "main",
      installationId: INSTALLATION_ID,
    })
    .returning({ id: projects.id });
  assert(project);
  await db
    .insert(projectMembers)
    .values({ projectId: project.id, userId: user.id, role: "owner" });
  const res = await app.request(`/api/projects/${project.id}/health`, {
    headers: { cookie: "cockpit_session=cookie-of-1000" },
  });
  expect(res.status).toBe(200);
  const { lines } = (await res.json()) as { lines: Line[] };
  return lines.find((l) => l.key === "webhook") as Line;
}

describe("085 D: the red webhook line leads to the settings of the App", () => {
  it("given a webhook with another address, when the health is requested, then the red line carries the settings URL of the App", async () => {
    const line = await webhookLine({ url: "https://cockpit.example.com/hook" });

    expect(line).toMatchObject({ ok: false, detail: "wrong_url" });
    expect(line.url).toBe("https://github.com/settings/apps/cockpit-test");
  });

  it("given a failed last delivery, when the health is requested, then the red line carries the settings URL of the App", async () => {
    const line = await webhookLine({
      deliveries: [{ status_code: 500 }],
    });

    expect(line).toMatchObject({ ok: false, detail: "last_delivery_failed" });
    expect(line.url).toBe("https://github.com/settings/apps/cockpit-test");
  });

  it("given a healthy webhook, when the health is requested, then the line has no url", async () => {
    const line = await webhookLine({ url: DEFAULT_WEBHOOK_URL });

    expect(line.ok).toBe(true);
    expect(line.url).toBeUndefined();
  });
});
