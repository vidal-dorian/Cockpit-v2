import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findingSourceRows } from "./test-findings.ts";
import {
  codeScanning,
  commitLocation,
  dependabot,
  githubRows,
  locationReads,
  refreshed,
  SECRET,
  secretScanning,
  stored,
  withAlerts,
} from "./test-github-alerts.ts";
import { deliveryRow, pass, seedDelivery } from "./test-issue-edit.ts";

// Slice R6 (decision 052 C): the webhooks `dependabot_alert`, `code_scanning_alert` and `secret_scanning_alert`, processed like a read (the pass of decision 025 A, `processDeliveries`).
//
// Pinned where the decision leaves it open (the developer follows these):
// - A delivery of one of the three events carries what GitHub sends: `{ action, alert, repository: { id }, installation: { id } }`, `alert` being the alert as the REST API serves it
//   (the same objects as the fakes of test-github-alerts.ts). The finding is found, created or updated by the tool of the event and `alert.number`, with the same mapping as a read (decision 052 D),
//   whatever the action: the state of the alert decides. `alert.state` open: the finding is created, or updated and reopened (github_closed_at null); any other state (fixed, dismissed,
//   auto_dismissed, resolved...): an existing finding is dated closed on GitHub (github_closed_at now, if it was not) and its status is not touched; an alert never read and not open creates nothing.
// - A secret scanning delivery asks `GET .../secret-scanning/alerts/<n>/locations` like a read does (the payload holds no location); the value `alert.secret` that GitHub sends is never stored in a finding,
//   a source, a ticket or the history (the recorded delivery itself is the business of the webhook route, decision 024).
// - A delivery whose repository is not a tracked project is processed and writes nothing. Every handled delivery gets its `processed_at` date. No history entry is written for a success.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Ctx = Awaited<ReturnType<typeof withAlerts>>;
const EVENTS = {
  dependabot: "dependabot_alert",
  code_scanning: "code_scanning_alert",
  secret_scanning: "secret_scanning_alert",
} as const;

/** Delivers an alert of a tool with an action, as GitHub does, and runs one pass; returns the delivery id. */
async function deliver(
  ctx: Ctx,
  tool: keyof typeof EVENTS,
  action: string,
  alert: Record<string, unknown>,
  repoId = 1,
) {
  const id = await seedDelivery(ctx.db, {
    event: EVENTS[tool],
    action,
    repoId,
    payload: {
      action,
      alert,
      installation: { id: 77 },
      repository: { id: repoId, full_name: "user1000/app" },
      sender: { login: "dependabot[bot]" },
    },
  });
  await pass(ctx.db);
  return id;
}

describe("decision 052 C: an alert received by webhook is processed like a read", () => {
  it("given a dependabot_alert created, when a pass runs, then the finding exists as a read would make it and the delivery is processed", async () => {
    const ctx = await withAlerts();

    const id = await deliver(
      ctx,
      "dependabot",
      "created",
      dependabot(7, {
        name: "symfony/http-kernel",
        summary: "Fuite de cookie",
      }),
    );

    expect((await deliveryRow(ctx.db, id)).processed_at).not.toBeNull();
    const [row] = await githubRows(ctx.db);
    expect(row).toMatchObject({
      project_id: ctx.projectId,
      kind: "security",
      source: "github",
      title: "symfony/http-kernel : Fuite de cookie",
      severity: "high",
      status: "open",
      commit_sha: null,
      github_alert_type: "dependabot",
      github_alert_number: 7,
      github_closed_at: null,
    });
    expect(row?.body_md).toContain("GHSA-aaaa-bbbb-0007");
  });

  it("given the same alert read by « Actualiser » and then received by webhook, when a pass runs, then there is still one finding", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
    await refreshed(ctx);

    await deliver(
      ctx,
      "dependabot",
      "created",
      dependabot(1, { summary: "texte à jour" }),
    );

    const found = await githubRows(ctx.db);
    expect(found).toHaveLength(1);
    expect(found[0]?.title).toBe("vendor/pkg-1 : texte à jour");
  });

  it("given a code_scanning_alert created, when a pass runs, then the finding has the title of the rule, the lines of the latest occurrence and its commit", async () => {
    const ctx = await withAlerts();

    await deliver(
      ctx,
      "code_scanning",
      "created",
      codeScanning(4, {
        description: "Injection SQL",
        path: "api/src/db.ts",
        start: 10,
        end: 12,
        commit: ctx.sha,
      }),
    );

    const [row] = await githubRows(ctx.db);
    expect(row).toMatchObject({
      source: "github",
      title: "Injection SQL",
      severity: "high",
      commit_sha: ctx.sha,
      github_alert_type: "code_scanning",
      github_alert_number: 4,
    });
    expect(await findingSourceRows(ctx.db)).toEqual([
      expect.objectContaining({
        path: "api/src/db.ts",
        start_line: 10,
        end_line: 12,
      }),
    ]);
  });

  it("given a secret_scanning_alert created that carries the secret, when a pass runs, then the finding cites the first commit location asked to GitHub and the value of the secret is stored nowhere", async () => {
    const ctx = await withAlerts((a, c) => {
      a.locations[2] = [commitLocation("api/src/db.ts", 5, 9, c.sha)];
    });

    await deliver(ctx, "secret_scanning", "created", secretScanning(2));

    const [row] = await githubRows(ctx.db);
    expect(row).toMatchObject({
      severity: "critical",
      title: "Secret exposé : GitHub Personal Access Token",
      commit_sha: ctx.sha,
      github_alert_type: "secret_scanning",
      github_alert_number: 2,
    });
    expect(await findingSourceRows(ctx.db)).toEqual([
      expect.objectContaining({
        path: "api/src/db.ts",
        start_line: 5,
        end_line: 9,
      }),
    ]);
    expect(locationReads(ctx)).toHaveLength(1);
    const text = await stored(ctx.db);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("SUPERSECRET");
  });

  it.each(["fixed", "dismissed", "auto_dismissed", "resolved"])(
    "given a finding of an alert, when GitHub sends the action %s with the alert closed, then github_closed_at is dated and the status does not move",
    async (action) => {
      const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
      await refreshed(ctx);

      await deliver(
        ctx,
        "dependabot",
        action,
        dependabot(1, { state: action }),
      );

      const [row] = await githubRows(ctx.db);
      expect(row?.github_closed_at).not.toBeNull();
      expect(
        Math.abs(Date.parse(String(row?.github_closed_at)) - Date.now()),
      ).toBeLessThan(60_000);
      expect(row?.status).toBe("open");
    },
  );

  it("given a code scanning finding closed on GitHub, when GitHub sends it reopened, then github_closed_at is null again and the status is the same", async () => {
    const ctx = await withAlerts((a, c) =>
      a.code_scanning.push(codeScanning(1, { commit: c.sha })),
    );
    await refreshed(ctx);
    await deliver(
      ctx,
      "code_scanning",
      "fixed",
      codeScanning(1, { state: "fixed", commit: ctx.sha }),
    );
    expect((await githubRows(ctx.db))[0]?.github_closed_at).not.toBeNull();

    await deliver(
      ctx,
      "code_scanning",
      "reopened",
      codeScanning(1, { commit: ctx.sha }),
    );

    expect((await githubRows(ctx.db))[0]).toMatchObject({
      github_closed_at: null,
      status: "open",
    });
  });

  it("given a finding put off by the human, when its alert is fixed then reopened on GitHub, then it is still later", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
    await refreshed(ctx);
    await ctx.db.execute(sql`update findings set status = 'later'`);

    await deliver(
      ctx,
      "dependabot",
      "fixed",
      dependabot(1, { state: "fixed" }),
    );
    await deliver(ctx, "dependabot", "reopened", dependabot(1));

    expect((await githubRows(ctx.db))[0]).toMatchObject({
      status: "later",
      github_closed_at: null,
    });
  });

  it("given an alert never read that GitHub sends already closed, when a pass runs, then no finding is created", async () => {
    const ctx = await withAlerts();

    const id = await deliver(
      ctx,
      "dependabot",
      "fixed",
      dependabot(9, { state: "fixed" }),
    );

    expect(await githubRows(ctx.db)).toEqual([]);
    expect((await deliveryRow(ctx.db, id)).processed_at).not.toBeNull();
  });

  it("given an alert of a repository that is not a tracked project, when a pass runs, then the delivery is processed and nothing is written", async () => {
    const ctx = await withAlerts();

    const id = await deliver(
      ctx,
      "dependabot",
      "created",
      dependabot(1),
      424_242,
    );

    expect((await deliveryRow(ctx.db, id)).processed_at).not.toBeNull();
    expect(await githubRows(ctx.db)).toEqual([]);
  });

  it("given the three events, when a pass runs, then no history entry is written for the successes", async () => {
    const ctx = await withAlerts((a, c) => {
      a.locations[1] = [commitLocation("api/src/db.ts", 5, 9, c.sha)];
    });

    await deliver(ctx, "dependabot", "created", dependabot(1));
    await deliver(
      ctx,
      "code_scanning",
      "created",
      codeScanning(1, { commit: ctx.sha }),
    );
    await deliver(ctx, "secret_scanning", "created", secretScanning(1));

    expect(await githubRows(ctx.db)).toHaveLength(3);
    const entries = (await ctx.db.execute(
      sql`select count(*)::int as n from history where action in ('process_webhook', 'refresh_github_alerts')`,
    )) as unknown as { rows: { n: number }[] };
    expect(entries.rows[0]?.n).toBe(0);
  });
});
