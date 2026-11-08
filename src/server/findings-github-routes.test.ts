import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import { finding, submitted } from "./test-findings.ts";
import {
  codeScanning,
  commitLocation,
  dependabot,
  githubRows,
  REPO_URL,
  refreshed,
  secretScanning,
  withAlerts,
} from "./test-github-alerts.ts";
import { callTool, dataOf, type Row, rows } from "./test-mcp.ts";
import { ticketRows } from "./test-takeover.ts";

// Slice R6 (decision 052 D, F, H): what the findings routes do with the findings of GitHub, read through app.request() after a refresh.
//
// Pinned where the decision leaves it open (the developer follows these; the web tests of src/web/FindingsGitHub.test.tsx use the same):
// - GET /api/projects/:id/findings gives, for every finding, githubAlertType, githubAlertNumber, githubClosedAt (ISO or null) and githubUrl
//   (`<https://github.com/owner/repo>/security/<dependabot|code-scanning|secret-scanning>/<number>`), all null for a finding of Claude; commitSha is null for a finding with no commit.
// - A finding closed on GitHub (githubClosedAt set) is not to decide: `?status=open` and `?status=later` do not list it whatever its status, `?status=dismissed` lists it (decision 052 F:
//   « il apparaît dans le filtre Rejetés »), without a filter every finding is listed. Its `status` and `dismissReason` are untouched.
// - Ticket, dismiss and later on a finding closed on GitHub: 409 { error: "not_open" } and one refused entry (detail { reason: "not_open" }), like a ticketed or dismissed one.
// - « En faire un ticket » on a GitHub finding puts the link of the alert (githubUrl) in the description of the ticket, after the body; for a finding with sources, the permalinks too.
// - list_findings (the tool of Claude, decision 051 B) lists the findings of GitHub with the others, `files` empty for a Dependabot one (it cites none).
// - GET /api/projects/:id/code serves a (commit, path) cited by a source of a GitHub finding, as for the findings of Claude.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Listed = {
  id: number;
  source: string;
  status: string;
  title: string;
  commitSha: string | null;
  dismissReason: string | null;
  githubAlertType: string | null;
  githubAlertNumber: number | null;
  githubClosedAt: string | null;
  githubUrl: string | null;
  sources: { path: string; startLine: number; endLine: number }[];
};
type Ctx = Awaited<ReturnType<typeof withAlerts>>;
const list = async (ctx: Ctx, query = "") => {
  const res = await send(
    ctx.app,
    ctx.alice.cookie,
    "GET",
    `/api/projects/${ctx.projectId}/findings${query}`,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { findings: Listed[] }).findings;
};
const decide = (ctx: Ctx, verb: "ticket" | "dismiss" | "later", id: number) =>
  send(ctx.app, ctx.alice.cookie, "POST", `/api/findings/${id}/${verb}`);

/** A project with one finding of each tool, then the Dependabot alert closed on GitHub and refreshed: the first finding is closed on GitHub. */
async function withClosed() {
  const ctx = await withAlerts((a, c) => {
    a.dependabot.push(dependabot(1), dependabot(2));
    a.code_scanning.push(codeScanning(1, { commit: c.sha }));
    a.secret_scanning.push(secretScanning(1));
    a.locations[1] = [commitLocation("api/src/db.ts", 5, 9, c.sha)];
  });
  await refreshed(ctx);
  ctx.fetchMock.alerts("user1000/app").dependabot.splice(0, 1);
  await refreshed(ctx);
  const found = await list(ctx);
  const closed = found.find((f) => f.githubClosedAt !== null) as Listed;
  return { ...ctx, closed, found };
}

describe("decision 052 D, H: the findings of GitHub in the list", () => {
  it("given the alerts of three tools read, when a member reads the findings, then each carries its source, its tool, its number, its alert link and no closing date", async () => {
    const ctx = await withAlerts((a, c) => {
      a.dependabot.push(dependabot(7));
      a.code_scanning.push(codeScanning(3, { commit: c.sha }));
      a.secret_scanning.push(secretScanning(2));
      a.locations[2] = [commitLocation("api/src/db.ts", 5, 9, c.sha)];
    });
    await refreshed(ctx);

    const found = await list(ctx);

    const by = (type: string) => found.find((f) => f.githubAlertType === type);
    expect(by("dependabot")).toMatchObject({
      source: "github",
      githubAlertNumber: 7,
      githubUrl: `${REPO_URL}/security/dependabot/7`,
      githubClosedAt: null,
      commitSha: null,
      sources: [],
    });
    expect(by("code_scanning")).toMatchObject({
      githubAlertNumber: 3,
      githubUrl: `${REPO_URL}/security/code-scanning/3`,
      commitSha: ctx.sha,
    });
    expect(by("secret_scanning")).toMatchObject({
      githubAlertNumber: 2,
      githubUrl: `${REPO_URL}/security/secret-scanning/2`,
      sources: [{ path: "api/src/db.ts", startLine: 5, endLine: 9 }],
    });
  });

  it("given a finding of Claude, when the findings are read, then its github fields are null", async () => {
    const ctx = await withAlerts();
    await submitted(ctx, [finding(1)]);

    const [only] = await list(ctx);

    expect(only).toMatchObject({
      source: "claude",
      githubAlertType: null,
      githubAlertNumber: null,
      githubClosedAt: null,
      githubUrl: null,
    });
  });

  it("given the finding of a Dependabot alert, when list_findings is called, then it is there with no file, next to the findings of Claude", async () => {
    const ctx = await withAlerts((a) =>
      a.dependabot.push(dependabot(1, { name: "symfony/http-kernel" })),
    );
    await refreshed(ctx);
    await submitted(ctx, [finding(1)]);

    const data = dataOf<{
      findings: {
        title: string;
        kind: string;
        status: string;
        files: string[];
      }[];
    }>(
      await callTool(ctx.app, ctx.alice.secret, "list_findings", {
        project_id: ctx.projectId,
      }),
    );

    expect(data.findings.map((f) => f.title)).toEqual([
      "symfony/http-kernel : Fuite de cookie 1",
      "constat-1",
    ]);
    expect(data.findings[0]).toMatchObject({
      kind: "security",
      status: "open",
      files: [],
    });
  });

  it("given a code scanning finding, when the file it cites is asked at its commit, then the route serves the lines as for a finding of Claude", async () => {
    const ctx = await withAlerts((a, c) =>
      a.code_scanning.push(
        codeScanning(1, {
          path: "api/src/db.ts",
          start: 10,
          end: 12,
          commit: c.sha,
        }),
      ),
    );
    await refreshed(ctx);

    const res = await ctx.app.request(
      `/api/projects/${ctx.projectId}/code?${new URLSearchParams({ sha: ctx.sha, path: "api/src/db.ts", start: "10", end: "12" })}`,
      { headers: { cookie: ctx.alice.cookie } },
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { lines: string[] }).lines).toContain(
      "db 10",
    );
  });
});

describe("decision 052 F: a finding closed on GitHub is no longer to decide", () => {
  it("given a finding closed on GitHub, when the findings are read, then it has its closing date, and its status and reason are untouched", async () => {
    const ctx = await withClosed();

    expect(ctx.closed).toMatchObject({
      source: "github",
      githubAlertType: "dependabot",
      githubAlertNumber: 1,
      status: "open",
      dismissReason: null,
    });
    expect(
      Math.abs(Date.parse(ctx.closed.githubClosedAt as string) - Date.now()),
    ).toBeLessThan(60_000);
  });

  it("given a finding closed on GitHub, when the findings are read by status, then open and later do not list it, dismissed does, and no filter lists every finding", async () => {
    const ctx = await withClosed();

    const ids = async (query: string) =>
      (await list(ctx, query)).map((f) => f.id).sort();

    expect(await ids("?status=open")).not.toContain(ctx.closed.id);
    expect(await ids("?status=open")).toHaveLength(ctx.found.length - 1);
    expect(await ids("?status=later")).toEqual([]);
    expect(await ids("?status=dismissed")).toEqual([ctx.closed.id]);
    expect(await ids("")).toHaveLength(ctx.found.length);
    expect(await ids("?status=ticketed")).toEqual([]);
  });

  it("given a dismissed finding and a finding closed on GitHub, when « dismissed » is read, then both are listed", async () => {
    const ctx = await withClosed();
    const other = ctx.found.find((f) => f.id !== ctx.closed.id) as Listed;
    expect((await decide(ctx, "dismiss", other.id)).status).toBe(200);

    const dismissed = (await list(ctx, "?status=dismissed")).map((f) => f.id);

    expect(dismissed.sort()).toEqual([ctx.closed.id, other.id].sort());
  });

  it.each(["ticket", "dismiss", "later"] as const)(
    "given a finding closed on GitHub, when %s is called on it, then 409 not_open, nothing changes and one refused entry is left",
    async (verb) => {
      const ctx = await withClosed();
      const before = await githubRows(ctx.db);
      const tickets = await ticketRows(ctx.db);

      const res = await decide(ctx, verb, ctx.closed.id);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_open" });
      expect(await githubRows(ctx.db)).toEqual(before);
      expect(await ticketRows(ctx.db)).toEqual(tickets);
      const refused = (await rows(ctx.db, sql`result = 'refused'`)) as Row[];
      expect(refused).toHaveLength(1);
      expect(refused[0]?.detail).toEqual({ reason: "not_open" });
    },
  );

  it("given a finding closed on GitHub that is open again on GitHub, when it is refreshed, then it can be decided again", async () => {
    const ctx = await withClosed();
    ctx.fetchMock.alerts("user1000/app").dependabot.push(dependabot(1));
    await refreshed(ctx);

    expect((await decide(ctx, "later", ctx.closed.id)).status).toBe(200);
  });
});

describe("decision 052 H: « En faire un ticket » on a finding of GitHub", () => {
  it("given a Dependabot finding, when a member makes a ticket of it, then the ticket holds the title, the body and the link of the alert", async () => {
    const ctx = await withAlerts((a) => a.dependabot.push(dependabot(7)));
    await refreshed(ctx);
    const [one] = await githubRows(ctx.db);

    const res = await decide(ctx, "ticket", one?.id as number);

    expect(res.status).toBe(200);
    const { ticket } = (await res.json()) as {
      ticket: { id: number; title: string };
    };
    expect(ticket.title).toBe("vendor/pkg-7 : Fuite de cookie 7");
    const made = (await ticketRows(ctx.db)).find((t) => t.id === ticket.id);
    expect(made?.description_md).toContain("GHSA-aaaa-bbbb-0007");
    expect(made?.description_md).toContain(`${REPO_URL}/security/dependabot/7`);
    expect((await githubRows(ctx.db))[0]).toMatchObject({
      status: "ticketed",
      ticket_id: ticket.id,
    });
  });

  it("given a secret finding with a cited line, when a ticket is made, then it holds the permalink of the line and the link of the alert, and never the secret", async () => {
    const ctx = await withAlerts((a, c) => {
      a.secret_scanning.push(secretScanning(2));
      a.locations[2] = [commitLocation("api/src/db.ts", 5, 9, c.sha)];
    });
    await refreshed(ctx);
    const [one] = await githubRows(ctx.db);

    await decide(ctx, "ticket", one?.id as number);

    const [ticket] = await ticketRows(ctx.db);
    expect(ticket?.description_md).toContain(
      `https://github.com/user1000/app/blob/${ctx.sha}/api/src/db.ts#L5-L9`,
    );
    expect(ticket?.description_md).toContain(
      `${REPO_URL}/security/secret-scanning/2`,
    );
    expect(ticket?.description_md).not.toContain("SUPERSECRET");
  });
});
