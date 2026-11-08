import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import { findingSourceRows, setStatus } from "./test-findings.ts";
import {
  ALERT_PERMISSIONS,
  BASE_PERMISSIONS,
  githubCalls,
  INSTALLATION_ID,
  installationUrl,
} from "./test-github.ts";
import {
  alertReads,
  codeScanning,
  commitLocation,
  dependabot,
  githubRows,
  issueLocation,
  locationReads,
  REPO_URL,
  refresh,
  refreshed,
  SECRET,
  secretScanning,
  stored,
  withAlerts,
} from "./test-github-alerts.ts";
import { archiveProject, type Row, rows, userWithToken } from "./test-mcp.ts";

// Slice R6 (decision 052 C, D, E, F): « Actualiser », the read of the alerts of GitHub into findings, through app.request() on PGlite against the fake GitHub
// (src/server/test-github.ts: `alerts(fullName)` holds the raw alerts; `appInfo` and `installationInfo` the permissions). The shapes are pinned in src/server/test-github-alerts.ts.
//
// Pinned where the decision leaves it open (the developer follows these):
// - POST /api/projects/:id/findings/refresh: 401 without a session, 404 { error: "Not found" } for a non-member and an unknown project (no history entry), 409 { error: "project_archived" }
//   for an archived project (one `refused` entry, detail { reason: "project_archived" }), nothing read from GitHub in those cases.
// - Reads, in this order of knowledge: `GET /app` and `GET /app/installations/<installationId>` as the App (a JWT, in parallel) give `access` (decision 052 B) and the permissions of the
//   installation. A tool whose permission (dependabot_alerts, security_events for code scanning, secret_scanning_alerts) the installation lacks is `no_permission`: it is NOT read.
//   The others are read with the installation token (never the JWT), `state=open`, `per_page=100`, `page=1..10` at most; a 403 or a 404 from GitHub on a tool says it is not enabled
//   on the repo: `disabled`. Any other failure (including a failure of GET /app or of the installation) is 502 { error: "github_unavailable" }: nothing changes, one `error`
//   history entry (detail { reason: "error" }), and no text of GitHub anywhere.
// - `created` is the number of findings inserted, `updated` the number of existing findings whose alert was read again (changed or not), `closed` the number closed by this read.
// - The history keeps ONE entry per served refresh: actor human, origin ui, action `refresh_github_alerts`, project_id, args { projectId, created, updated, closed } (numbers), result ok.
// - Every finding of GitHub: kind security, source github, status open, effort null. A new finding is `open` whatever the state of its alert was (only open alerts are read).
// - Title and body_md are the texts of decision 052 D: Dependabot « <package> : <summary> », body with the GHSA id, the CVE id (when there is one), the ecosystem, the vulnerable versions,
//   the first patched version, the manifest and the html_url of the alert; code scanning: title the `rule.description`, body with the tool name, the rule id, the message and the html_url;
//   secret scanning: title « Secret exposé : <secret_type_display_name> » (the `secret_type` when there is no display name), body with that type and the html_url, severity critical.
// - Lines: Dependabot cites none and has no commit (commit_sha null); code scanning cites `most_recent_instance.location` at `most_recent_instance.commit_sha`, which is also the commit_sha of
//   the finding; secret scanning asks `GET .../secret-scanning/alerts/<n>/locations` once per alert read and cites the FIRST location of type `commit` (path, lines, commit_sha), the commit_sha of
//   the finding being that commit; with no commit location it cites nothing and has no commit. No line is verified on GitHub (the contents are not read).

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const entries = (db: Parameters<typeof rows>[0], action: string) =>
  rows(db, sql`action = ${action}`) as Promise<Row[]>;

describe("decision 052 C: who may refresh", () => {
  it("given a member, when he refreshes with no alert on GitHub, then 200 with every tool ok, nothing created, updated or closed, and no access problem", async () => {
    const ctx = await withAlerts();

    const res = await refresh(ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tools: { dependabot: "ok", code_scanning: "ok", secret_scanning: "ok" },
      created: 0,
      updated: 0,
      closed: 0,
      access: null,
    });
  });

  it("given a non-member, no session or an unknown project, when it is refreshed, then 404, 401 and 404, nothing is read and no entry is left", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const before = githubCalls(ctx.fetchMock).length;

    const stranger = await refresh(ctx, bob.cookie);
    const anonymous = await refresh(ctx, "");
    const unknown = await refresh(ctx, ctx.alice.cookie, 99_999);

    expect(stranger.status).toBe(404);
    expect(await stranger.json()).toEqual({ error: "Not found" });
    expect(anonymous.status).toBe(401);
    expect(unknown.status).toBe(404);
    expect(alertReads(ctx)).toEqual([]);
    expect(githubCalls(ctx.fetchMock)).toHaveLength(before);
    expect(await entries(ctx.db, "refresh_github_alerts")).toEqual([]);
    expect(await githubRows(ctx.db)).toEqual([]);
  });

  it("given an archived project, when it is refreshed, then 409 project_archived like the other writes, GitHub is not read, nothing is stored and one refused entry is left", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
    await archiveProject(ctx.db, ctx.projectId);

    const res = await refresh(ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project_archived" });
    expect(alertReads(ctx)).toEqual([]);
    expect(await githubRows(ctx.db)).toEqual([]);
    const refused = await rows(ctx.db, sql`result = 'refused'`);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({
      action: "refresh_github_alerts",
      detail: { reason: "project_archived" },
    });
  });
});

describe("decision 052 C: the permissions and the tools", () => {
  it("given a refresh, when GitHub is asked, then the App and its installation are read as the App, the alerts as the installation, open ones only, 100 per page", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));

    await refreshed(ctx);

    const app = githubCalls(ctx.fetchMock).filter(
      (c) =>
        c.path === "/app" || c.path === `/app/installations/${INSTALLATION_ID}`,
    );
    expect(
      app
        .filter((c) => c.method === "GET")
        .map((c) => c.path)
        .sort(),
    ).toEqual(["/app", `/app/installations/${INSTALLATION_ID}`]);
    for (const c of app.filter((c) => c.method === "GET"))
      expect(c.authorization).toMatch(/^bearer eyJ/i);
    const reads = alertReads(ctx);
    expect(reads.map((r) => r.tool).sort()).toEqual([
      "code-scanning",
      "dependabot",
      "secret-scanning",
    ]);
    // Review: secret scanning is asked with hide_secret=true so GitHub does not even send the value.
    expect(
      reads
        .find((r) => r.tool === "secret-scanning")
        ?.params.get("hide_secret"),
    ).toBe("true");
    for (const read of reads) {
      expect(read.params.get("state")).toBe("open");
      expect(read.params.get("per_page")).toBe("100");
      expect(read.authorization).not.toMatch(/^bearer eyJ/i);
      expect(read.authorization).toContain("ghs_x");
    }
  });

  it.each([
    ["dependabot", "dependabot_alerts"],
    ["code_scanning", "security_events"],
    ["secret_scanning", "secret_scanning_alerts"],
  ] as const)(
    "given an installation that lacks the permission of %s, when it is refreshed, then that tool is no_permission and not read, the others are ok, and access says what to approve",
    async (tool, permission) => {
      const lacking = Object.fromEntries(
        Object.entries({ ...BASE_PERMISSIONS, ...ALERT_PERMISSIONS }).filter(
          ([name]) => name !== permission,
        ),
      );
      const ctx = await withAlerts(() => {}, {
        installationInfo: { permissions: lacking },
      });

      const body = await refreshed(ctx);

      expect(body.tools).toEqual({
        dependabot: "ok",
        code_scanning: "ok",
        secret_scanning: "ok",
        [tool]: "no_permission",
      });
      expect(body.access).toEqual({
        detail: "installation_not_approved",
        url: installationUrl(),
      });
      expect(alertReads(ctx).map((r) => r.tool)).not.toContain(
        tool.replace("_", "-"),
      );
    },
  );

  it("given an App that does not ask for a permission, when it is refreshed, then access is app_missing_permissions with the permissions page of the App", async () => {
    const lacking = Object.fromEntries(
      Object.entries({ ...BASE_PERMISSIONS, ...ALERT_PERMISSIONS }).filter(
        ([name]) => name !== "security_events",
      ),
    );
    const ctx = await withAlerts(() => {}, {
      appInfo: { permissions: lacking },
      installationInfo: { permissions: lacking },
    });

    const body = await refreshed(ctx);

    expect(body.tools.code_scanning).toBe("no_permission");
    expect(body.access).toEqual({
      detail: "app_missing_permissions",
      url: "https://github.com/settings/apps/cockpit-test/permissions",
    });
  });

  it.each([
    ["dependabot", 403],
    ["code_scanning", 404],
    ["secret_scanning", 403],
  ] as const)(
    "given GitHub that answers the tool %s with %s (not enabled on the repo), when it is refreshed, then that tool is disabled and the others are read",
    async (tool, status) => {
      const ctx = await withAlerts((a) => {
        a.status[tool] = status;
        a.dependabot.push(dependabot(1));
        a.code_scanning.push(codeScanning(1));
        a.secret_scanning.push(secretScanning(1));
        a.locations[1] = [];
      });

      const body = await refreshed(ctx);

      expect(body.tools).toEqual({
        dependabot: "ok",
        code_scanning: "ok",
        secret_scanning: "ok",
        [tool]: "disabled",
      });
      expect(body.created).toBe(2);
      expect(body.access).toBeNull();
    },
  );

  it.each([
    ["GET /app", { appInfo: { status: 500 } }],
    ["the installation", { installationInfo: { status: 500 } }],
  ])(
    "given GitHub that fails on %s, when it is refreshed, then 502 github_unavailable, nothing is stored, and one error entry with no text of GitHub",
    async (_name, github) => {
      const ctx = await withAlerts(
        (a) => a.dependabot.push(dependabot(1)),
        github,
      );

      const res = await refresh(ctx);

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "github_unavailable" });
      expect(await githubRows(ctx.db)).toEqual([]);
      const [entry] = await entries(ctx.db, "refresh_github_alerts");
      expect(entry).toMatchObject({
        result: "error",
        detail: { reason: "error" },
      });
      expect(JSON.stringify(entry)).not.toContain("github-boom-message");
    },
  );

  it("given GitHub that answers 500 on one tool, when it is refreshed, then 502 and nothing is stored, not even what the other tools gave", async () => {
    const ctx = await withAlerts((a) => {
      a.status.code_scanning = 500;
      a.dependabot.push(dependabot(1));
    });

    const res = await refresh(ctx);

    expect(res.status).toBe(502);
    expect(await githubRows(ctx.db)).toEqual([]);
  });
});

describe("decision 052 C: the pages and the history", () => {
  it("given 1,100 open alerts of one tool, when it is refreshed, then ten pages of 100 are read, no eleventh, and 1,000 findings are created", async () => {
    const ctx = await withAlerts((a) => {
      for (let n = 1; n <= 1_100; n++) a.dependabot.push(dependabot(n));
    });

    const body = await refreshed(ctx);

    const pages = alertReads(ctx)
      .filter((r) => r.tool === "dependabot")
      .map((r) => r.page);
    expect(Math.max(...pages)).toBe(10);
    expect([...new Set(pages)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    expect(body.created).toBe(1_000);
    expect(await githubRows(ctx.db)).toHaveLength(1_000);
  }, 60_000);

  it("given 250 open alerts, when it is refreshed, then the three pages are read in turn from the first and 250 findings are created", async () => {
    const ctx = await withAlerts((a) => {
      for (let n = 1; n <= 250; n++) a.dependabot.push(dependabot(n));
    });

    const body = await refreshed(ctx);

    const pages = alertReads(ctx)
      .filter((r) => r.tool === "dependabot")
      .map((r) => r.page);
    expect(pages.slice(0, 3)).toEqual([1, 2, 3]);
    // Decision 052 C: a page of fewer than 100 alerts is the last one.
    expect(Math.max(...pages)).toBe(3);
    expect(body.created).toBe(250);
  });

  it.each([
    [99, [1]],
    [100, [1, 2]],
    [101, [1, 2]],
  ])(
    "given %s open alerts, when it is refreshed, then the pages read are %j (a page of fewer than 100 is the last one)",
    async (count, expected) => {
      const ctx = await withAlerts((a) => {
        for (let n = 1; n <= count; n++) a.dependabot.push(dependabot(n));
      });

      await refreshed(ctx);

      const pages = alertReads(ctx)
        .filter((r) => r.tool === "dependabot")
        .map((r) => r.page);
      expect([...new Set(pages)].sort((a, b) => a - b)).toEqual(expected);
    },
  );

  it("given alerts of the three tools, when it is refreshed, then one refresh_github_alerts entry of the human, from the UI, holds the project and the three counts, and no text of an alert", async () => {
    const ctx = await withAlerts((a) => {
      a.dependabot.push(dependabot(1, { summary: "texte-secret-de-l-avis" }));
      a.code_scanning.push(codeScanning(1));
      a.secret_scanning.push(secretScanning(1));
      a.locations[1] = [];
    });

    await refreshed(ctx);

    const found = await entries(ctx.db, "refresh_github_alerts");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      project_id: ctx.projectId,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { projectId: ctx.projectId, created: 3, updated: 0, closed: 0 },
    });
    expect(JSON.stringify(found[0])).not.toContain("texte-secret-de-l-avis");
  });
});

describe("decision 052 D: an alert becomes a finding", () => {
  it("given a Dependabot alert, when it is refreshed, then a security finding of source github is created with the title « paquet : résumé », the severity of the advisory, the texts of the alert, no commit and no cited line", async () => {
    const ctx = await withAlerts((a) =>
      a.dependabot.push(
        dependabot(7, {
          summary: "Fuite de cookie",
          name: "symfony/http-kernel",
        }),
      ),
    );

    const body = await refreshed(ctx);

    expect(body).toMatchObject({ created: 1, updated: 0, closed: 0 });
    const [row] = await githubRows(ctx.db);
    expect(row).toMatchObject({
      project_id: ctx.projectId,
      kind: "security",
      source: "github",
      title: "symfony/http-kernel : Fuite de cookie",
      severity: "high",
      status: "open",
      effort: null,
      ticket_id: null,
      commit_sha: null,
      github_alert_type: "dependabot",
      github_alert_number: 7,
      github_closed_at: null,
    });
    for (const text of [
      "GHSA-aaaa-bbbb-0007",
      "CVE-2026-1007",
      "composer",
      ">= 5.4.0, < 5.4.20",
      "5.4.20",
      "composer.lock",
      `${REPO_URL}/security/dependabot/7`,
    ])
      expect(row?.body_md, text).toContain(text);
    expect(await findingSourceRows(ctx.db)).toEqual([]);
  });

  it.each([
    ["low", "low"],
    ["medium", "medium"],
    ["moderate", "medium"],
    ["high", "high"],
    ["critical", "critical"],
  ])(
    "given a Dependabot advisory of severity %s, when it is refreshed, then the finding is %s",
    async (advisory, severity) => {
      const ctx = await withAlerts((a) =>
        a.dependabot.push(dependabot(1, { severity: advisory })),
      );

      await refreshed(ctx);

      expect((await githubRows(ctx.db))[0]?.severity).toBe(severity);
    },
  );

  it("given a Dependabot alert with no CVE and no patched version, when it is refreshed, then the finding is created all the same with its GHSA id", async () => {
    const ctx = await withAlerts((a) =>
      a.dependabot.push(dependabot(3, { cve: null, patched: null })),
    );

    const body = await refreshed(ctx);

    expect(body.created).toBe(1);
    expect((await githubRows(ctx.db))[0]?.body_md).toContain(
      "GHSA-aaaa-bbbb-0003",
    );
  });

  it("given a code scanning alert, when it is refreshed, then the finding has the title of the rule, the texts of the alert, the lines of the latest occurrence at its commit, and that commit", async () => {
    const ctx = await withAlerts((a, c) =>
      a.code_scanning.push(
        codeScanning(4, {
          description: "Injection SQL dans la recherche",
          path: "api/src/db.ts",
          start: 10,
          end: 12,
          commit: c.sha,
        }),
      ),
    );

    const body = await refreshed(ctx);

    expect(body.created).toBe(1);
    const [row] = await githubRows(ctx.db);
    expect(row).toMatchObject({
      kind: "security",
      source: "github",
      title: "Injection SQL dans la recherche",
      severity: "high",
      commit_sha: ctx.sha,
      github_alert_type: "code_scanning",
      github_alert_number: 4,
    });
    for (const text of [
      "CodeQL",
      "js/sql-injection",
      "Cette requête dépend d'une valeur fournie 4.",
      `${REPO_URL}/security/code-scanning/4`,
    ])
      expect(row?.body_md, text).toContain(text);
    expect(await findingSourceRows(ctx.db)).toEqual([
      {
        finding_id: row?.id,
        criterion_id: null,
        position: 0,
        path: "api/src/db.ts",
        start_line: 10,
        end_line: 12,
        commit_sha: ctx.sha,
      },
    ]);
  });

  it.each([
    [
      "a critical security severity over a note (so critical)",
      "note",
      "critical",
      "critical",
    ],
    [
      "a medium security severity over an error (so medium)",
      "error",
      "medium",
      "medium",
    ],
    ["no security severity and an error (so high)", "error", null, "high"],
    [
      "no security severity and a warning (so medium)",
      "warning",
      null,
      "medium",
    ],
    ["no security severity and a note (so low)", "note", null, "low"],
  ] as const)(
    "given a code scanning rule with %s, when it is refreshed, then the severity is the one in brackets",
    async (_name, severity, securitySeverity, expected) => {
      const ctx = await withAlerts((a, c) =>
        a.code_scanning.push(
          codeScanning(1, { severity, securitySeverity, commit: c.sha }),
        ),
      );

      await refreshed(ctx);

      expect((await githubRows(ctx.db))[0]?.severity).toBe(expected);
    },
  );

  it("given a secret scanning alert with locations, when it is refreshed, then the finding is critical, titled « Secret exposé : <type> », cites the first commit location at its commit, and the locations were asked once", async () => {
    const ctx = await withAlerts((a, c) => {
      a.secret_scanning.push(secretScanning(2));
      a.locations[2] = [
        issueLocation,
        commitLocation("api/src/db.ts", 5, 9, c.sha),
        commitLocation("web/src/types.ts", 1, 2, c.sha),
      ];
    });

    const body = await refreshed(ctx);

    expect(body.created).toBe(1);
    const [row] = await githubRows(ctx.db);
    expect(row).toMatchObject({
      kind: "security",
      source: "github",
      title: "Secret exposé : GitHub Personal Access Token",
      severity: "critical",
      commit_sha: ctx.sha,
      github_alert_type: "secret_scanning",
      github_alert_number: 2,
    });
    expect(row?.body_md).toContain("GitHub Personal Access Token");
    expect(row?.body_md).toContain(`${REPO_URL}/security/secret-scanning/2`);
    expect(await findingSourceRows(ctx.db)).toEqual([
      expect.objectContaining({
        finding_id: row?.id,
        path: "api/src/db.ts",
        start_line: 5,
        end_line: 9,
        commit_sha: ctx.sha,
      }),
    ]);
    expect(locationReads(ctx).map((c) => c.path)).toEqual([
      "/repos/user1000/app/secret-scanning/alerts/2/locations",
    ]);
  });

  it("given a secret scanning alert with no display name and no commit location, when it is refreshed, then the title uses the type, and the finding cites nothing and has no commit", async () => {
    const ctx = await withAlerts((a) => {
      a.secret_scanning.push(
        secretScanning(5, { display: null, type: "stripe_api_key" }),
      );
      a.locations[5] = [issueLocation];
    });

    await refreshed(ctx);

    const [row] = await githubRows(ctx.db);
    expect(row?.title).toBe("Secret exposé : stripe_api_key");
    expect(row?.commit_sha).toBeNull();
    expect(await findingSourceRows(ctx.db)).toEqual([]);
  });

  it("given three secret alerts, when it is refreshed, then the locations are asked once per alert", async () => {
    const ctx = await withAlerts((a) => {
      for (const n of [1, 2, 3]) {
        a.secret_scanning.push(secretScanning(n));
        a.locations[n] = [];
      }
    });

    await refreshed(ctx);

    expect(locationReads(ctx)).toHaveLength(3);
  });

  it("given secret alerts, when they are refreshed, then the value of the secret appears in no column of findings, code_sources, history and tickets, and not in the answer", async () => {
    const ctx = await withAlerts((a, c) => {
      a.secret_scanning.push(secretScanning(1));
      a.locations[1] = [commitLocation("api/src/db.ts", 5, 9, c.sha)];
      a.dependabot.push(dependabot(1));
    });

    const res = await refresh(ctx);
    const answer = await res.text();
    const [row] = await githubRows(ctx.db);
    await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/findings/${row?.id}/ticket`,
    );
    const list = await (
      await send(
        ctx.app,
        ctx.alice.cookie,
        "GET",
        `/api/projects/${ctx.projectId}/findings`,
      )
    ).text();

    for (const text of [answer, list, await stored(ctx.db)]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("SUPERSECRET");
    }
    expect(res.status).toBe(200);
  });

  it("given a text of GitHub with HTML and a script, when it is refreshed, then it is stored as it came (the screen renders it as safe Markdown, decision 052 D) and no field is lost", async () => {
    const ctx = await withAlerts((a) =>
      a.dependabot.push(
        dependabot(1, { summary: "<b>gras</b> & <script>x</script>" }),
      ),
    );

    await refreshed(ctx);

    expect((await githubRows(ctx.db))[0]?.title).toContain(
      "<script>x</script>",
    );
  });

  it("given a title of GitHub longer than the 200 characters Claude may write, when it is refreshed, then the finding is created all the same", async () => {
    const ctx = await withAlerts((a) =>
      a.dependabot.push(dependabot(1, { summary: "r".repeat(400) })),
    );

    const body = await refreshed(ctx);

    expect(body.created).toBe(1);
  });
});

describe("review O1: the same alert twice, or created meanwhile", () => {
  it("given a read that returns the same alert number twice (a page shift), when it is refreshed, then 200 and the alert is stored once", async () => {
    const ctx = await withAlerts((a) =>
      a.dependabot.push(dependabot(1), dependabot(1), dependabot(2)),
    );

    const res = await refresh(ctx);

    expect(res.status).toBe(200);
    expect(
      (await githubRows(ctx.db)).map((r) => r.github_alert_number),
    ).toEqual([1, 2]);
  });

  it("given a finding for the same tool and number created between the read and the store (a webhook), when it is refreshed, then 200 and there is still one finding for it", async () => {
    let landed = false;
    const ctx = await withAlerts((a) => {
      a.dependabot.push(dependabot(1));
      a.afterRead = async () => {
        a.afterRead = undefined;
        landed = true;
        await ctx.db.execute(
          sql`insert into findings (project_id, kind, source, title, body_md, severity, github_alert_type, github_alert_number)
              values (${ctx.projectId}, 'security', 'github', 'par webhook', 'b', 'high', 'dependabot', 1)`,
        );
      };
    });

    const res = await refresh(ctx);

    expect(landed, "the webhook landed after the read").toBe(true);
    expect(res.status).toBe(200);
    const rowsNow = await githubRows(ctx.db);
    expect(rowsNow).toHaveLength(1);
    expect(rowsNow[0]?.title).toBe("vendor/pkg-1 : Fuite de cookie 1");
  });
});

describe("decision 052 E: no duplicate, and the status is never touched", () => {
  it("given an alert already read, when it is refreshed again, then no second finding is created, updated counts it and the rows are the same", async () => {
    const ctx = await withAlerts((a) => {
      a.dependabot.push(dependabot(1));
      a.code_scanning.push(codeScanning(1));
    });
    const first = await refreshed(ctx);
    const before = await githubRows(ctx.db);

    const second = await refreshed(ctx);

    expect(first).toMatchObject({ created: 2, updated: 0, closed: 0 });
    expect(second).toMatchObject({ created: 0, updated: 2, closed: 0 });
    expect(await githubRows(ctx.db)).toEqual(before);
  });

  it("given alerts of two tools with the same number, when they are refreshed, then two findings exist: the number is only unique for a tool", async () => {
    const ctx = await withAlerts((a) => {
      a.dependabot.push(dependabot(1));
      a.code_scanning.push(codeScanning(1));
    });

    await refreshed(ctx);

    expect(
      (await githubRows(ctx.db)).map((r) => [
        r.github_alert_type,
        r.github_alert_number,
      ]),
    ).toEqual([
      ["dependabot", 1],
      ["code_scanning", 1],
    ]);
  });

  it("given an alert whose text changed on GitHub, when it is refreshed, then the title, the body and the severity of its finding are updated", async () => {
    const ctx = await withAlerts((a) =>
      a.dependabot.push(dependabot(1, { summary: "avant", severity: "low" })),
    );
    await refreshed(ctx);
    ctx.fetchMock.alerts("user1000/app").dependabot[0] = dependabot(1, {
      summary: "après",
      severity: "critical",
      patched: "9.9.9",
    });

    const body = await refreshed(ctx);

    expect(body.updated).toBe(1);
    const [row] = await githubRows(ctx.db);
    expect(row?.title).toBe("vendor/pkg-1 : après");
    expect(row?.severity).toBe("critical");
    expect(row?.body_md).toContain("9.9.9");
  });

  it("given a code scanning alert whose latest occurrence moved, when it is refreshed, then the lines and the commit of its finding follow", async () => {
    const ctx = await withAlerts((a, c) =>
      a.code_scanning.push(
        codeScanning(1, { start: 5, end: 9, commit: c.sha }),
      ),
    );
    await refreshed(ctx);
    const later = ctx.git.push({ "api/src/db.ts": "changed\n".repeat(30) });
    ctx.fetchMock.alerts("user1000/app").code_scanning[0] = codeScanning(1, {
      start: 20,
      end: 22,
      commit: later,
    });

    await refreshed(ctx);

    const sources = await findingSourceRows(ctx.db);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      start_line: 20,
      end_line: 22,
      commit_sha: later,
    });
    expect((await githubRows(ctx.db))[0]?.commit_sha).toBe(later);
  });

  it.each([
    ["dismissed", { reason: "faux positif" }],
    ["later", {}],
  ])(
    "given a finding put in status %s by the human, when its alert is read again with new text, then the text is updated and the status is not",
    async (status, extra) => {
      const ctx = await withAlerts((a) =>
        a.dependabot.push(dependabot(1, { summary: "avant" })),
      );
      await refreshed(ctx);
      const id = (await githubRows(ctx.db))[0]?.id as number;
      await setStatus(ctx.db, id, status, extra);
      ctx.fetchMock.alerts("user1000/app").dependabot[0] = dependabot(1, {
        summary: "après",
      });

      await refreshed(ctx);

      const [row] = await githubRows(ctx.db);
      expect(row).toMatchObject({ status, title: "vendor/pkg-1 : après" });
    },
  );

  it("given a finding made a ticket, when its alert is read again, then it stays ticketed with its ticket", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
    await refreshed(ctx);
    const id = (await githubRows(ctx.db))[0]?.id;
    const ticket = await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/findings/${id}/ticket`,
    );
    expect(ticket.status).toBe(200);

    await refreshed(ctx);

    expect((await githubRows(ctx.db))[0]).toMatchObject({ status: "ticketed" });
    expect((await githubRows(ctx.db))[0]?.ticket_id).not.toBeNull();
  });
});

describe("decision 052 F: an alert closed or reopened on GitHub", () => {
  const closedAt = async (ctx: Awaited<ReturnType<typeof withAlerts>>) =>
    (await githubRows(ctx.db)).map((r) => r.github_closed_at);

  it("given a finding whose alert is no longer in the open list, when the tool is read ok, then github_closed_at is dated, the status does not move, and closed counts it", async () => {
    const ctx = await withAlerts((a) => {
      a.dependabot.push(dependabot(1), dependabot(2));
    });
    await refreshed(ctx);
    ctx.fetchMock.alerts("user1000/app").dependabot.splice(0, 1);

    const body = await refreshed(ctx);

    expect(body).toMatchObject({ created: 0, updated: 1, closed: 1 });
    const [one, two] = await githubRows(ctx.db);
    expect(one?.github_closed_at).not.toBeNull();
    expect(
      Math.abs(Date.parse(String(one?.github_closed_at)) - Date.now()),
    ).toBeLessThan(60_000);
    expect(one?.status).toBe("open");
    expect(two?.github_closed_at).toBeNull();
  });

  it("given a ticketed finding whose alert is gone, when it is refreshed, then it is dated as closed on GitHub and stays ticketed", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
    await refreshed(ctx);
    const id = (await githubRows(ctx.db))[0]?.id;
    await send(ctx.app, ctx.alice.cookie, "POST", `/api/findings/${id}/ticket`);
    ctx.fetchMock.alerts("user1000/app").dependabot.length = 0;

    await refreshed(ctx);

    const [row] = await githubRows(ctx.db);
    expect(row?.status).toBe("ticketed");
    expect(row?.github_closed_at).not.toBeNull();
  });

  it("given a finding already closed on GitHub, when it is refreshed again and the alert is still absent, then closed is 0 and the date does not move", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
    await refreshed(ctx);
    ctx.fetchMock.alerts("user1000/app").dependabot.length = 0;
    await refreshed(ctx);
    const [first] = await closedAt(ctx);

    const body = await refreshed(ctx);

    expect(body.closed).toBe(0);
    expect((await closedAt(ctx))[0]).toEqual(first);
  });

  it.each(["no_permission", "disabled"])(
    "given a tool that is %s at this refresh, when its alert is absent from the list, then its findings are not closed",
    async (verdict) => {
      const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
      await refreshed(ctx);
      if (verdict === "no_permission")
        ctx.fetchMock.update({
          installationInfo: {
            permissions: {
              ...BASE_PERMISSIONS,
              security_events: "read",
              secret_scanning_alerts: "read",
            },
          },
        });
      else ctx.fetchMock.alerts("user1000/app").status.dependabot = 403;

      const body = await refreshed(ctx);

      expect(body.tools.dependabot).toBe(verdict);
      expect(body.closed).toBe(0);
      expect(await closedAt(ctx)).toEqual([null]);
    },
  );

  it("given an alert of another tool that is gone, when only the first tool is read ok, then only the findings of the tools read ok are closed", async () => {
    const ctx = await withAlerts((a) => {
      a.dependabot.push(dependabot(1));
      a.code_scanning.push(codeScanning(1));
    });
    await refreshed(ctx);
    const alerts = ctx.fetchMock.alerts("user1000/app");
    alerts.dependabot.length = 0;
    alerts.status.code_scanning = 404;

    const body = await refreshed(ctx);

    expect(body.closed).toBe(1);
    const [dep, code] = await githubRows(ctx.db);
    expect(dep?.github_closed_at).not.toBeNull();
    expect(code?.github_closed_at).toBeNull();
  });

  it("given a finding closed on GitHub, when its alert is open again in the list, then github_closed_at is null again, the status is the same and it counts as updated", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(1)));
    await refreshed(ctx);
    const alerts = ctx.fetchMock.alerts("user1000/app");
    const [alert] = alerts.dependabot.splice(0, 1);
    await refreshed(ctx);
    expect((await closedAt(ctx))[0]).not.toBeNull();
    alerts.dependabot.push(alert as Record<string, unknown>);

    const body = await refreshed(ctx);

    expect(body).toMatchObject({ created: 0, updated: 1, closed: 0 });
    const [row] = await githubRows(ctx.db);
    expect(row).toMatchObject({ github_closed_at: null, status: "open" });
    expect(await githubRows(ctx.db)).toHaveLength(1);
  });

  it("given alerts dismissed or fixed on GitHub that were never read, when it is refreshed, then they are not read at all and create no finding", async () => {
    const ctx = await withAlerts((a) => {
      a.dependabot.push(dependabot(1, { state: "fixed" }), dependabot(2));
    });

    const body = await refreshed(ctx);

    expect(body.created).toBe(1);
    expect(
      (await githubRows(ctx.db)).map((r) => r.github_alert_number),
    ).toEqual([2]);
  });
});
