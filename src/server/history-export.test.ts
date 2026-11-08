import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { history } from "./db/schema.ts";
import {
  base,
  project,
  setup,
  type TestDb,
  userWithSession,
} from "./test-history.ts";

// Decision 053 H (slice 11.1): GET /api/history/export, the filtered journal as a CSV.
//
// Pinned choices (the decision leaves them open):
// - Same session rule as the journal (401 { error: "Unauthorized" } without one), same filters and same 400 { error: "invalid_filter" }; `before` plays no part.
// - Content-Type text/csv with charset utf-8; Content-Disposition `attachment; filename="journal-<YYYY-MM-DD>.csv"`, the date being the server's current day in UTC.
// - No byte order mark: the first characters are the header line `date,acteur,origine,action,resultat,code,projet,ticket,us,run,arguments`.
// - Rows are in the order of the journal (newest first). Cells: date = `at` as ISO 8601 UTC (toISOString); acteur, origine, resultat = the codes of the database (human, claude, github, system / ui, mcp, webhook, system / ok, refused, error);
//   action = the action name; code = detail.reason or empty; projet = the full name (owner/repo) or empty; ticket, us, run = the number or empty; arguments = JSON.stringify(args) ({} when none).
// - RFC 4180 quoting: a cell with a comma, a double quote, a line feed or a carriage return is wrapped in double quotes and its quotes are doubled. Lines end with \r\n or \n (the tests accept both).
// - A cell that starts with =, +, -, @, a tab or a carriage return gets a leading apostrophe (the apostrophe is added before the quoting). Nothing else is changed.
// - At most 10 000 rows after the header: the 10 000 most recent that match.
// - Reading the export writes no history entry.

const HEADER =
  "date,acteur,origine,action,resultat,code,projet,ticket,us,run,arguments";
const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

afterEach(() => {
  vi.useRealTimers();
});

/** A small RFC 4180 reader: the records of a CSV text, each a list of cells. */
function parseCsv(text: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(cell);
      cell = "";
    } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
      if (c === "\r") i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  return records;
}

async function exportOf(
  app: Awaited<ReturnType<typeof setup>>["app"],
  cookie: string,
  query = "",
) {
  const res = await app.request(`/api/history/export${query}`, {
    headers: { cookie },
  });
  const text = await res.text();
  return { res, text, records: parseCsv(text) };
}

const count = async (db: TestDb) =>
  Number(
    (
      (await db.execute(sql`select count(*) as n from history`)) as unknown as {
        rows: { n: string }[];
      }
    ).rows[0]?.n,
  );

describe("GET /api/history/export, the file (decision 053 H)", () => {
  it("given no session, when the export is requested, then it answers 401", async () => {
    const { app } = await setup();

    const res = await app.request("/api/history/export");

    expect(res.status).toBe(401);
  });

  it("given a session and the day pinned to 2026-11-08, when the export is requested, then it answers a UTF-8 CSV attachment named journal-2026-11-08.csv", async () => {
    const { app, db } = await setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
    const a = await userWithSession(db, 1);

    const res = await app.request("/api/history/export", {
      headers: { cookie: a.cookie },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(
      /^text\/csv;\s*charset=utf-8$/i,
    );
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="journal-2026-11-08.csv"',
    );
  });

  it("given no entry, when the export is requested, then the file is the header line alone", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);

    const { text, records } = await exportOf(app, a.cookie);

    expect(
      text.startsWith(`${HEADER}\r\n`) || text.startsWith(`${HEADER}\n`),
    ).toBe(true);
    expect(records).toEqual([HEADER.split(",")]);
  });

  it("given entries with a project, ticket, story, run, args and a refusal code, when the export is requested, then each row has the columns in order, newest first", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const p = await project(db, 1, "octocat/hello");
    await db.insert(history).values([
      { ...base, userId: a.id, action: "login", at: at(1) },
      {
        ...base,
        userId: a.id,
        actor: "claude",
        origin: "mcp",
        result: "refused",
        action: "create_user_stories",
        at: at(2),
        projectId: p,
        ticketId: 7,
        storyId: 8,
        runId: 9,
        // jsonb keeps its keys sorted (shorter first): the fixture is already in that order, so the cell can be compared as text.
        args: { draft: true, ticket_id: 7 },
        detail: { reason: "criterion_incomplete" },
      },
    ]);

    const { records } = await exportOf(app, a.cookie);

    expect(records[0]).toEqual(HEADER.split(","));
    expect(records.slice(1)).toEqual([
      [
        at(2).toISOString(),
        "claude",
        "mcp",
        "create_user_stories",
        "refused",
        "criterion_incomplete",
        "octocat/hello",
        "7",
        "8",
        "9",
        '{"draft":true,"ticket_id":7}',
      ],
      [
        at(1).toISOString(),
        "human",
        "ui",
        "login",
        "ok",
        "",
        "",
        "",
        "",
        "",
        "{}",
      ],
    ]);
  });

  it("given args with commas and quotes, when the export is requested, then the cell is quoted with its quotes doubled and reads back as the JSON", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values({
      ...base,
      userId: a.id,
      action: "login",
      at: at(1),
      args: { a: 1, b: 'say "hi"' },
    });

    const { text, records } = await exportOf(app, a.cookie);

    expect(text).toContain('"{""a"":1,""b"":""say \\""hi\\""""}"');
    expect(JSON.parse(records[1]?.[10] ?? "")).toEqual({ a: 1, b: 'say "hi"' });
  });

  it("given a refusal code with a comma, a quote and a line break, when the export is requested, then the file holds one record per entry and the code reads back unchanged", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const reason = 'one, "two"\nthree\r\nfour';
    await db.insert(history).values([
      {
        ...base,
        userId: a.id,
        result: "refused",
        action: "login",
        at: at(1),
        detail: { reason },
      },
      { ...base, userId: a.id, action: "logout", at: at(2) },
    ]);

    const { records } = await exportOf(app, a.cookie);

    expect(records).toHaveLength(3);
    expect(records[2]?.[5]).toBe(reason);
    expect(records[1]?.[3]).toBe("logout");
  });

  it.each([
    ["=", "=1+1"],
    ["+", "+33612345678"],
    ["-", "-2+3"],
    ["@", "@SUM(A1)"],
    ["a tab", "\tcmd"],
    ["a carriage return", "\rcmd"],
  ])(
    "given a refusal code that starts with %s, when the export is requested, then the cell gets a leading apostrophe",
    async (_name, reason) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1);
      await db.insert(history).values({
        ...base,
        userId: a.id,
        result: "refused",
        action: "login",
        at: at(1),
        detail: { reason },
      });

      const { records } = await exportOf(app, a.cookie);

      expect(records[1]?.[5]).toBe(`'${reason}`);
    },
  );

  it("given an action that starts with =, when the export is requested, then its cell gets the apostrophe too, and a cell that does not start with a formula sign stays as it is", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values([
      { ...base, userId: a.id, action: "=HYPERLINK(1)", at: at(1) },
      { ...base, userId: a.id, action: "safe=1+1", at: at(2) },
    ]);

    const { records } = await exportOf(app, a.cookie);

    expect(records[2]?.[3]).toBe("'=HYPERLINK(1)");
    expect(records[1]?.[3]).toBe("safe=1+1");
  });

  it("given 10 005 entries, when the export is requested, then it holds the header and the 10 000 most recent rows", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.execute(sql`
      insert into history (user_id, actor, origin, action, result, at)
      select ${a.id}, 'human', 'ui', 'login', 'ok',
        timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => g)
      from generate_series(1, 10005) g`);

    const { records } = await exportOf(app, a.cookie);

    expect(records).toHaveLength(10_001);
    expect(records[1]?.[0]).toBe("2026-01-01T02:46:45.000Z");
    expect(records[10_000]?.[0]).toBe("2026-01-01T00:00:06.000Z");
  });
});

describe("GET /api/history/export, the filters (decision 053 H)", () => {
  it("given entries of several projects, actors and results, when the export is requested with filters, then only the matching rows are in the file", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const one = await project(db, 1, "octocat/one");
    const two = await project(db, 2, "octocat/two");
    await db.insert(history).values([
      {
        ...base,
        userId: a.id,
        action: "kept",
        actor: "claude",
        result: "refused",
        projectId: one,
        at: at(10),
      },
      {
        ...base,
        userId: a.id,
        action: "other_project",
        actor: "claude",
        result: "refused",
        projectId: two,
        at: at(11),
      },
      {
        ...base,
        userId: a.id,
        action: "other_result",
        actor: "claude",
        projectId: one,
        at: at(12),
      },
      {
        ...base,
        userId: a.id,
        action: "too_old",
        actor: "claude",
        result: "refused",
        projectId: one,
        at: at(1),
      },
    ]);

    const { records } = await exportOf(
      app,
      a.cookie,
      `?project=${one}&actor=claude&result=refused,error&since=${at(5).toISOString()}`,
    );

    expect(records.slice(1).map((r) => r[3])).toEqual(["kept"]);
  });

  it("given a search, when the export is requested with q, then it applies the same search as the journal", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values([
      { ...base, userId: a.id, action: "create_ticket", at: at(1) },
      { ...base, userId: a.id, action: "login", at: at(2) },
      { ...base, userId: a.id, action: "plain", ticketId: 42, at: at(3) },
    ]);

    expect(
      (await exportOf(app, a.cookie, "?q=TICKET")).records
        .slice(1)
        .map((r) => r[3]),
    ).toEqual(["create_ticket"]);
    expect(
      (await exportOf(app, a.cookie, "?q=%2342")).records
        .slice(1)
        .map((r) => r[3]),
    ).toEqual(["plain"]);
  });

  it.each([
    "actor=robot",
    "result=nope",
    "project=abc",
    "since=yesterday",
    "q=",
  ])(
    "given the bad filter %s, when the export is requested, then it answers 400 invalid_filter and no file",
    async (filter) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1);

      const res = await app.request(`/api/history/export?${filter}`, {
        headers: { cookie: a.cookie },
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_filter" });
    },
  );

  it("given entries of another user, when the export is requested, then only the caller's rows are in the file, even with the other user's project", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const b = await userWithSession(db, 2);
    const p = await project(db, 1, "octocat/shared");
    await db.insert(history).values([
      { ...base, userId: a.id, action: "mine", projectId: p, at: at(1) },
      { ...base, userId: b.id, action: "theirs", projectId: p, at: at(2) },
      { ...base, userId: null, action: "nobody", projectId: p, at: at(3) },
    ]);

    const all = await exportOf(app, a.cookie);
    const onProject = await exportOf(app, a.cookie, `?project=${p}`);

    expect(all.records.slice(1).map((r) => r[3])).toEqual(["mine"]);
    expect(onProject.records.slice(1).map((r) => r[3])).toEqual(["mine"]);
    expect(all.text).not.toContain("theirs");
  });

  it("given an export, when it has been read, then no entry is added to the journal", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db
      .insert(history)
      .values({ ...base, userId: a.id, action: "login", at: at(1) });
    const before = await count(db);

    await exportOf(app, a.cookie);
    await exportOf(app, a.cookie, "?actor=human");

    expect(await count(db)).toBe(before);
  });
});
