// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { send } from "./test-decisions.ts";
import { type App, rows, type TestDb } from "./test-mcp.ts";

// Shared by the tests of slice 11.3 (decision 056): the routes called the way the page calls them, and the tables read with raw SQL.
//
// Pinned shapes (the decision leaves them open):
// - GET /api/projects/:id/issues -> 200 { issues: [{ number, title, state: "open" | "closed", kind: "story" | "ticket",
//   inCockpit: { storyId: number } | { ticketId: number } | null }] } (no other key, order free: tests compare sets); 401, 404 (not a member or unknown),
//   502 { error: "github_unavailable" }. The server reads `GET /repos/{o}/{r}/issues?state=all&per_page=100&page=n` (n = 1..10, following the pages).
//   A pull request (an item with a `pull_request` key) is never listed. No history entry, no write call on GitHub.
// - POST /api/projects/:id/issues/import { numbers: number[] } -> 200 { tickets, stories, skipped } (three counts, numbers); 400 { error: "Bad request" }
//   (numbers missing, not an array, empty, over 200, or not positive integers), 401, 404, 409 { error: "project_archived" }, 502 { error: "github_unavailable" }
//   (nothing created). The numbers are deduplicated first; `skipped` counts the distinct numbers not imported (closed, pull request, unknown on GitHub,
//   already in Cockpit, lost to a concurrent import). The server re-reads GitHub with the same list read as GET /issues (state=all, 10 pages at most).
// - tickets.github_issue_number integer null, unique index (project_id, github_issue_number); the ticket of GET /api/projects/:id/tickets and of
//   GET /api/tickets/:id carries `githubIssueNumber: number | null`.
// - The imported ticket: title cut to 200 characters, description_md = the body (a null body is ""), at most 50,000 characters: a longer body is cut so that the whole text,
//   mention included, is 50,000 characters and ends with « (tronqué : la suite est sur GitHub) »; priority normal, no tag.
// - The imported story: position 1 of its ticket, status ready, as_a / i_want / so_that and the criteria (positions 1..n) as read by `readStoryIssue`, notes_md "",
//   issue_number = the issue, issue_body_hash null; its ticket has stories_written_at set.
// - The history entry `import_issues`: actor human, origin ui, the user and the project, no ticket and no story, result ok, args { tickets, stories, skipped } and no detail.

export const REPO = "user1000/app";
/** The `githubRepoId` of Alice's project (withProject). */
export const REPO_ID = 1;

export const MENTION = "(tronqué : la suite est sur GitHub)";

export const listIssues = (
  app: App,
  cookie: string | null,
  projectId: number | string,
) =>
  app.request(`/api/projects/${projectId}/issues`, {
    headers: cookie ? { cookie } : {},
  });

export const importIssues = (
  app: App,
  cookie: string,
  projectId: number | string,
  numbers: unknown,
) =>
  send(app, cookie, "POST", `/api/projects/${projectId}/issues/import`, {
    numbers,
  });

export type Listed = {
  number: number;
  title: string;
  state: string;
  kind: string;
  inCockpit: { storyId: number } | { ticketId: number } | null;
};
export type Counts = { tickets: number; stories: number; skipped: number };

/** An issue body written as a user story: one narrative and two criteria (one in French, one in English). */
export const STORY_BODY = [
  "Contexte : les gens veulent partager leurs tâches.",
  "",
  "En tant que lectrice, je veux exporter mes tâches en PDF, afin de les partager.",
  "",
  "- Étant donné une liste de tâches, quand j'exporte, alors un PDF est téléchargé",
  "- [ ] Given an empty list, when I export, then the button is disabled",
].join("\n");
export const STORY_PARTS = {
  asA: "lectrice",
  iWant: "exporter mes tâches en PDF",
  soThat: "les partager",
  criteria: [
    {
      given: "une liste de tâches",
      when: "j'exporte",
      then: "un PDF est téléchargé",
    },
    {
      given: "an empty list",
      when: "I export",
      then: "the button is disabled",
    },
  ],
};
export const BUG_BODY = "Le bouton ne répond pas.\n\n1. Ouvrir\n2. Cliquer";

type Result<T> = { rows: T[] };
const all = async <T>(db: TestDb, query: ReturnType<typeof sql>) =>
  ((await db.execute(query)) as unknown as Result<T>).rows;

export const ticketRows = (db: TestDb, projectId: number) =>
  all<{
    id: number;
    title: string;
    description_md: string;
    priority: string;
    tags: string[];
    github_issue_number: number | null;
    stories_written_at: Date | null;
  }>(
    db,
    sql`select id, title, description_md, priority, tags, github_issue_number, stories_written_at from tickets where project_id = ${projectId} order by id`,
  );

export const storyRows = (db: TestDb, projectId: number) =>
  all<{
    id: number;
    ticket_id: number;
    position: number;
    status: string;
    as_a: string;
    i_want: string;
    so_that: string;
    notes_md: string;
    issue_number: number | null;
    issue_body_hash: string | null;
  }>(
    db,
    sql`select s.id, s.ticket_id, s.position, s.status, s.as_a, s.i_want, s.so_that, s.notes_md, s.issue_number, s.issue_body_hash from user_stories s join tickets t on t.id = s.ticket_id where t.project_id = ${projectId} order by s.id`,
  );

export const criteriaOf = async (db: TestDb, storyId: number) =>
  (
    await all<{ position: number; g: string; w: string; t: string }>(
      db,
      sql`select position, given_text as g, when_text as w, then_text as t from acceptance_criteria where story_id = ${storyId} order by position`,
    )
  ).map((c) => ({
    position: c.position,
    given: c.g,
    when: c.w,
    then: c.t,
  }));

export const importEntries = (db: TestDb) =>
  rows(db, sql`action = 'import_issues'`);

/** Every entry but the fixture's token: "this call wrote nothing in the history". */
export const entriesButToken = (db: TestDb) =>
  rows(db, sql`action <> 'create_token'`);

/** Links a story to an issue number, as a publication would have. */
export const linkStory = (db: TestDb, storyId: number, number: number) =>
  db.execute(
    sql`update user_stories set issue_number = ${number} where id = ${storyId}`,
  );
/** Links a ticket to an issue number, as an import would have. */
export const linkTicket = (db: TestDb, ticketId: number, number: number) =>
  db.execute(
    sql`update tickets set github_issue_number = ${number} where id = ${ticketId}`,
  );
