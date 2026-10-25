import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { sha256 } from "./auth.ts";
import type { Db } from "./db/db.ts";
import {
  mcpTokens,
  projectMembers,
  projects,
  tickets,
  users,
} from "./db/schema.ts";
import type { ReadGitHub } from "./github.ts";
import { memberProject, memberProjects } from "./projects.ts";
import {
  createTicket,
  descriptionMd,
  memberTicket,
  noNul,
  ticketStep,
  title,
} from "./tickets.ts";

// Decision 016. The body is read whole in memory: same 256 KiB as the API routes (the global limit only covers /api/*).
const MAX_BODY = 256 * 1024;
const MAX_RESULTS = 20;

/** The caller of a tool and what the call writes to the history. `entry` is filled in as the call learns the ids it concerns. */
type Call = { db: Db; userId: number; entry: Entry; readGitHub: ReadGitHub };

/** Arguments that do not fit the schema of the tool; `fields` names the faulty ones, for Claude only (the history gets the fixed code). */
class InvalidArguments extends Refused {
  fields: string;
  constructor(fields: string) {
    super("invalid_arguments");
    this.fields = fields;
  }
}

/** Writes the `refused` entry of a call that stops before its work: `act` records the refusal and rethrows it. */
const refuse = (db: Db, entry: Entry, error: Refused): Promise<never> =>
  act(db, entry, async () => {
    throw error;
  });

/** A project of the caller, or a journaled `not_found` (someone else's project looks like no project). */
async function ownProject(call: Call, id: number) {
  const project = await memberProject(call.db, call.userId, id);
  if (!project) return refuse(call.db, call.entry, new Refused("not_found"));
  call.entry.projectId = project.id;
  return project;
}

const id = z.number().int().min(1).max(2_147_483_647);

/** A tool: validates its arguments, then runs. `inputSchema` is what `tools/list` shows Claude. */
function tool<S extends z.ZodObject>(
  description: string,
  schema: S,
  run: (call: Call, args: z.output<S>) => Promise<unknown>,
) {
  return {
    description,
    inputSchema: z.toJSONSchema(schema, { io: "input" }),
    async call(call: Call, raw: unknown) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const fields = parsed.error.issues
          .map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`)
          .join("; ");
        return refuse(call.db, call.entry, new InvalidArguments(fields));
      }
      return run(call, parsed.data);
    },
  };
}

// The descriptions are the product (decision 004): they are written so that a vague request leads to the right tool.
const tools = {
  list_projects: tool(
    "List the projects the user works on in Cockpit (id, GitHub name, default branch). Use it first when the user mentions a project by name or asks what they have, to get the project_id the other tools need. Archived projects are not listed.",
    z.object({}),
    async (call) =>
      act(call.db, call.entry, async (tx) => ({
        projects: (await memberProjects(tx, call.userId))
          .filter((p) => !p.archivedAt)
          .map((p) => ({
            id: p.id,
            full_name: p.fullName,
            default_branch: p.defaultBranch,
          })),
      })),
  ),

  get_project: tool(
    "Get one project: its details, the CLAUDE.md of its repository (empty when it has none; claude_md_unreachable is true when GitHub can no longer be reached for this repo) and its tickets (id, title, step). Use it to learn a project's rules and to see what ideas are already noted before creating a ticket. Works on archived projects too.",
    z.object({ project_id: id.describe("Id from list_projects or search") }),
    async (call, { project_id }) => {
      call.entry.args = { projectId: project_id };
      const project = await ownProject(call, project_id);
      // GitHub is read before the transaction, which would otherwise hold a connection for up to three calls of 10 s each. A failure waits for `act`, which writes its one `error` entry.
      let claudeMd: string | null = "";
      let failed: unknown;
      try {
        const ready = await call.readGitHub();
        if (!ready) throw new Error("Cockpit is not configured");
        claudeMd = await ready.github.readClaudeMd(
          project.installationId,
          project.fullName,
        );
      } catch (error) {
        failed = error;
      }
      return act(call.db, call.entry, async (tx) => {
        if (failed) throw failed;
        const rows = await tx
          .select()
          .from(tickets)
          .where(eq(tickets.projectId, project.id))
          .orderBy(asc(tickets.id));
        return {
          project: {
            id: project.id,
            full_name: project.fullName,
            default_branch: project.defaultBranch,
            archived: project.archivedAt !== null,
          },
          // null: the App lost access to the repo; the project and its tickets are still worth returning.
          claude_md: claudeMd ?? "",
          claude_md_unreachable: claudeMd === null,
          tickets: rows.map((t) => ({
            id: t.id,
            title: t.title,
            step: ticketStep(t),
          })),
        };
      });
    },
  ),

  search: tool(
    "Search by words, when the user refers to a ticket or a project by a few words (for example 'the login idea on GestionProjet'). Every word must appear, whatever the case, in a project name or a ticket title; there is no spelling or synonym handling, so try other words (or get_project to list a project's tickets) when nothing comes back. At most 20 results, archived projects excluded.",
    z.object({
      query: z
        .string()
        .trim()
        .min(2)
        .max(200)
        .refine(noNul)
        .describe("Words to find, 2 to 200 characters"),
      project_id: id
        .optional()
        .describe("Only search the tickets of this project"),
    }),
    async (call, { query, project_id }) => {
      if (project_id !== undefined) {
        call.entry.args = { projectId: project_id };
        await ownProject(call, project_id);
      }
      // LIKE wildcards in the query are plain characters.
      const words = query.split(/\s+/).map((w) => w.replace(/[\\%_]/g, "\\$&"));
      const matching = (column: AnyPgColumn) =>
        and(...words.map((word) => ilike(column, `%${word}%`)));
      const mine = and(
        eq(projectMembers.userId, call.userId),
        isNull(projects.archivedAt),
      );
      return act(call.db, call.entry, async (tx) => {
        const found =
          project_id === undefined
            ? await tx
                .select({ id: projects.id, fullName: projects.fullName })
                .from(projects)
                .innerJoin(
                  projectMembers,
                  eq(projectMembers.projectId, projects.id),
                )
                .where(and(mine, matching(projects.fullName)))
                .orderBy(asc(projects.id))
                .limit(MAX_RESULTS)
            : [];
        const foundTickets = await tx
          .select({ ticket: tickets })
          .from(tickets)
          .innerJoin(projects, eq(projects.id, tickets.projectId))
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(
            and(
              mine,
              matching(tickets.title),
              project_id === undefined
                ? undefined
                : eq(tickets.projectId, project_id),
            ),
          )
          .orderBy(asc(tickets.id))
          .limit(MAX_RESULTS);
        return {
          results: [
            ...found.map((p) => ({
              type: "project",
              id: p.id,
              title: p.fullName,
              project_id: p.id,
            })),
            ...foundTickets.map(({ ticket }) => ({
              type: "ticket",
              id: ticket.id,
              title: ticket.title,
              project_id: ticket.projectId,
              step: ticketStep(ticket),
            })),
          ].slice(0, MAX_RESULTS),
        };
      });
    },
  ),

  get_ticket: tool(
    "Get one ticket: its title, its description in markdown, its step and its user stories. Use it when you have a ticket_id (from search or get_project) and need the whole idea. Works on tickets of archived projects too.",
    z.object({ ticket_id: id.describe("Id from search or get_project") }),
    async (call, { ticket_id }) => {
      call.entry.args = { ticketId: ticket_id };
      const found = await memberTicket(call.db, call.userId, ticket_id);
      if (!found) return refuse(call.db, call.entry, new Refused("not_found"));
      const { ticket } = found;
      call.entry.projectId = ticket.projectId;
      call.entry.ticketId = ticket.id;
      return act(call.db, call.entry, async () => ({
        id: ticket.id,
        project_id: ticket.projectId,
        title: ticket.title,
        description_md: ticket.descriptionMd,
        step: ticketStep(ticket),
        // User stories arrive with slice 4.3.
        stories: [],
      }));
    },
  ),

  create_ticket: tool(
    "Note a new idea as a ticket in a project (step 'new'). Use it when the user says things like 'note this idea on X' or 'add a ticket'. The title is a short sentence; the description is markdown and optional. It does not start any work. Refused on an archived project.",
    z.object({
      project_id: id.describe("Id from list_projects or search"),
      title: title.describe("Short title, 1 to 200 characters"),
      description_md: descriptionMd
        .optional()
        .describe("Markdown description, up to 50,000 characters"),
    }),
    async (call, args) => {
      call.entry.args = { projectId: args.project_id };
      const project = await ownProject(call, args.project_id);
      const ticket = await createTicket(call.db, call.entry, project.id, {
        title: args.title,
        descriptionMd: args.description_md,
      });
      return {
        id: ticket.id,
        project_id: ticket.projectId,
        title: ticket.title,
        step: ticketStep(ticket),
      };
    },
  ),
};

const TOOL_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/** What Claude reads after a refusal: why, and what to do (decision 004). */
const ADVICE: Record<string, string> = {
  not_found:
    "not found. The project or ticket does not exist or is not yours. Find the right id with list_projects or search, then call again.",
  project_archived:
    "this project is archived, so it is read-only. Tell the user, or use another project from list_projects.",
  unknown_tool:
    "unknown tool. Use only the tools this server lists (tools/list).",
};

function failure(error: unknown) {
  if (error instanceof InvalidArguments)
    return `Refused: invalid arguments (${error.fields}). Fix them and call the tool again.`;
  if (error instanceof Refused)
    return `Refused: ${ADVICE[error.message] ?? error.message}`;
  return "Error: the call failed (GitHub or the server did not answer as expected). Retry in a moment; if it keeps failing, tell the user.";
}

/** One tools/call. Whatever happens, one history entry is left (by `act`), and the outcome is a tool result: a refusal or an error is read by Claude, not a protocol error. */
async function callTool(
  base: Omit<Call, "entry">,
  tokenId: number,
  name: string,
  args: unknown,
): Promise<CallToolResult> {
  const known = Object.hasOwn(tools, name)
    ? tools[name as keyof typeof tools]
    : undefined;
  const entry: Entry = {
    userId: base.userId,
    tokenId,
    actor: "claude",
    origin: "mcp",
    // A name Claude made up is journaled as is only when it is a short identifier (decision 016).
    action: known || TOOL_NAME.test(name) ? name : "unknown_tool",
    args: {},
  };
  const call = { ...base, entry };
  try {
    const data = known
      ? await known.call(call, args ?? {})
      : await refuse(call.db, entry, new Refused("unknown_tool"));
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: failure(error) }] };
  }
}

/** Who sends the request, or why nobody (a fixed code; `tokenId` once the token was found). */
async function authenticate(db: Db, header: string | undefined) {
  if (header === undefined) return { reason: "missing_token" };
  const secret = /^Bearer +(\S+)$/i.exec(header)?.[1];
  const [found] = secret
    ? await db
        .select({ token: mcpTokens, blockedAt: users.blockedAt })
        .from(mcpTokens)
        .innerJoin(users, eq(users.id, mcpTokens.userId))
        .where(eq(mcpTokens.tokenHash, sha256(secret)))
    : [];
  if (!found) return { reason: "invalid_token" };
  const { token } = found;
  if (token.revokedAt) return { reason: "revoked_token", tokenId: token.id };
  if (found.blockedAt) return { reason: "blocked_user", tokenId: token.id };
  return { userId: token.userId, tokenId: token.id };
}

/** The MCP server (decisions 004 and 016): one POST, one JSON-RPC request, answered as JSON. Nothing is kept between two requests, so there is no session to lose. */
export function mcpRoutes(db: Db, readGitHub: ReadGitHub, version: string) {
  return (
    new Hono()
      .post("/mcp", async (c) => {
        const caller = await authenticate(db, c.req.header("authorization"));
        if ("reason" in caller) {
          // Nothing was presented: no entry, or anyone could grow the history for free (decision 010 E).
          if (caller.reason !== "missing_token") {
            const entry: Entry = {
              userId: null,
              tokenId: caller.tokenId ?? null,
              actor: "claude",
              origin: "mcp",
              action: "mcp_auth",
              args: {},
            };
            await refuse(db, entry, new Refused(caller.reason)).catch(
              (error) => {
                if (!(error instanceof Refused)) throw error;
              },
            );
          }
          return c.json({ error: caller.reason }, 401, {
            "WWW-Authenticate": "Bearer",
          });
        }
        await db
          .update(mcpTokens)
          .set({ lastUsedAt: sql`now()` })
          .where(eq(mcpTokens.id, caller.tokenId));

        const server = new Server(
          { name: "cockpit", version },
          { capabilities: { tools: {} } },
        );
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: Object.entries(tools).map(([name, t]) => ({
            name,
            description: t.description,
            inputSchema: t.inputSchema as { type: "object" },
          })),
        }));
        server.setRequestHandler(CallToolRequestSchema, ({ params }) =>
          callTool(
            { db, userId: caller.userId, readGitHub },
            caller.tokenId,
            params.name,
            params.arguments,
          ),
        );
        // No session id and no stream: the answer is one JSON body.
        const transport = new WebStandardStreamableHTTPServerTransport({
          enableJsonResponse: true,
          maxRequestBodySize: MAX_BODY,
        });
        await server.connect(transport);
        try {
          return await transport.handleRequest(c.req.raw);
        } finally {
          await server.close();
        }
      })
      // Without session there is no stream to open (GET) nor session to close (DELETE).
      .all("/mcp", (c) =>
        c.json({ error: "Method not allowed" }, 405, { Allow: "POST" }),
      )
  );
}
