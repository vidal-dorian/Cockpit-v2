import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  // Identity values are never reused, so history entries keep pointing at the right account.
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // GitHub ids can exceed 2^31, which an integer column cannot hold.
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  // Set by an administrator (decision 012 G): a blocked account cannot log in. Null when active.
  blockedAt: timestamp("blocked_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** The one row the start-up wizard fills (decision 012); the three secrets are AES-256-GCM values (secrets.ts), the key never enters the database. */
export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: integer("id").primaryKey(),
    publicUrl: text("public_url").notNull(),
    // Text, not a number: GitHub's App ids are opaque to Cockpit.
    githubAppId: text("github_app_id").notNull(),
    githubAppSlug: text("github_app_slug").notNull(),
    githubClientId: text("github_client_id").notNull(),
    githubClientSecret: text("github_client_secret").notNull(),
    githubPrivateKey: text("github_private_key").notNull(),
    githubWebhookSecret: text("github_webhook_secret").notNull(),
    // The SHA-256 of the cookie that lets the person who ran the wizard become the first administrator; null once spent.
    adminClaimHash: text("admin_claim_hash"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("instance_settings_single_row", sql`${t.id} = 1`)],
);

export const sessions = pgTable("sessions", {
  // The SHA-256 of the cookie value, so a leaked database gives no usable session (decision 009).
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

const FREQUENCIES = ["off", "on_demand", "daily", "weekly"] as const;

export const projects = pgTable(
  "projects",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    // One repo, one project for the whole instance (decision 008); GitHub ids can exceed 2^31.
    githubRepoId: bigint("github_repo_id", { mode: "number" })
      .notNull()
      .unique(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
    // The schedule of the writing of the user stories (decision 022 D): the hour and weekday are local to the time zone; `routineUserId` is the user whose routine fires it.
    routineFrequency: text("routine_frequency", { enum: FREQUENCIES })
      .notNull()
      .default("off"),
    routineHour: integer("routine_hour"),
    routineWeekday: integer("routine_weekday"),
    routineTimeZone: text("routine_time_zone").notNull().default("UTC"),
    routineNextRunAt: timestamp("routine_next_run_at", {
      withTimezone: true,
      mode: "date",
    }),
    routineUserId: integer("routine_user_id").references(() => users.id),
    routineLastRunAt: timestamp("routine_last_run_at", {
      withTimezone: true,
      mode: "date",
    }),
    routineLastRunResult: text("routine_last_run_result", {
      enum: ["ok", "error"],
    }),
    // Only a https://claude.ai address: the page makes it a link.
    routineLastRunSessionUrl: text("routine_last_run_session_url"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "projects_routine_frequency_check",
      sql`${t.routineFrequency} in ('off', 'on_demand', 'daily', 'weekly')`,
    ),
  ],
);

/** The scheduled task of a user on claude.ai (decision 022 C): its launch address and its token, encrypted with the instance key (secrets.ts); the token never leaves the server. */
export const writeUsRoutines = pgTable("write_us_routines", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id),
  fireUrl: text("fire_url").notNull(),
  token: text("token").notNull(),
  // Set when /fire refuses the token (401, 403 or 404): nothing is launched until a new one is saved (decision 022 G).
  needsReconnect: boolean("needs_reconnect").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** Who works on a project: the one place access lives (decisions 002 and 008). */
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["owner"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    // Enforces one member per project until sharing (decision 008).
    uniqueIndex("project_members_project_id_idx").on(t.projectId),
    check("project_members_role_check", sql`${t.role} in ('owner')`),
  ],
);

/** A raw idea of a project (decision 014). No step column: it is computed (decision 002). */
export const tickets = pgTable("tickets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  descriptionMd: text("description_md").notNull().default(""),
  abandonedAt: timestamp("abandoned_at", { withTimezone: true, mode: "date" }),
  // Empty while Claude has not finished writing the stories of the ticket (decision 017 N).
  storiesWrittenAt: timestamp("stories_written_at", {
    withTimezone: true,
    mode: "date",
  }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const STORY_STATUSES = [
  "to_validate",
  "to_rewrite",
  "ready",
  "in_progress",
  "in_review",
  "done",
  "abandoned",
] as const;

/** A user story of a ticket (decisions 002 and 017 A); the branch and PR columns come with their slices. */
export const userStories = pgTable(
  "user_stories",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id),
    // From 1, in the order Claude wrote them.
    position: integer("position").notNull(),
    asA: text("as_a").notNull(),
    iWant: text("i_want").notNull(),
    soThat: text("so_that").notNull(),
    notesMd: text("notes_md").notNull().default(""),
    status: text("status", { enum: STORY_STATUSES }).notNull(),
    rewriteComment: text("rewrite_comment"),
    // The GitHub issue of the story (decision 020 E): its number, the SHA-256 of the last body published, and the claim of a creation in flight (G).
    issueNumber: integer("issue_number"),
    issueBodyHash: text("issue_body_hash"),
    issueClaimedAt: timestamp("issue_claimed_at", {
      withTimezone: true,
      mode: "date",
    }),
    // The issue as someone edited it on GitHub and when (decision 025 C): all null while Cockpit's render and GitHub agree.
    issueGithubTitle: text("issue_github_title"),
    issueGithubBody: text("issue_github_body"),
    issueDivergedAt: timestamp("issue_diverged_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "user_stories_status_check",
      sql`${t.status} in ('to_validate', 'to_rewrite', 'ready', 'in_progress', 'in_review', 'done', 'abandoned')`,
    ),
  ],
);

export const acceptanceCriteria = pgTable("acceptance_criteria", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  storyId: integer("story_id")
    .notNull()
    .references(() => userStories.id),
  position: integer("position").notNull(),
  givenText: text("given_text").notNull(),
  whenText: text("when_text").notNull(),
  thenText: text("then_text").notNull(),
});

/** `storyId` needs `dependsOnId` done first. */
export const storyDependencies = pgTable(
  "story_dependencies",
  {
    storyId: integer("story_id")
      .notNull()
      .references(() => userStories.id),
    dependsOnId: integer("depends_on_id")
      .notNull()
      .references(() => userStories.id),
  },
  (t) => [
    primaryKey({ columns: [t.storyId, t.dependsOnId] }),
    check("story_dependencies_not_self", sql`${t.storyId} <> ${t.dependsOnId}`),
  ],
);

/** A personal MCP token (decisions 002 and 015): only the SHA-256 of the secret is kept, the secret is shown once. */
export const mcpTokens = pgTable("mcp_tokens", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastFour: text("last_four").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  // Only for a connection made by OAuth (decisions 006 E and 021 E): the client, the refresh token's hash, and the two expiries.
  clientId: text("client_id"),
  refreshHash: text("refresh_hash").unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  refreshExpiresAt: timestamp("refresh_expires_at", {
    withTimezone: true,
    mode: "date",
  }),
});

/** Append-only (triggers in the history_append_only migration); no foreign keys, so entries outlive what they point at (decision 010). */
export const history = pgTable(
  "history",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    userId: integer("user_id"),
    projectId: integer("project_id"),
    ticketId: integer("ticket_id"),
    storyId: integer("story_id"),
    // The MCP token behind an entry of origin mcp (decision 016); no foreign key, like the other ids.
    tokenId: integer("token_id"),
    actor: text("actor", {
      enum: ["human", "claude", "github", "system"],
    }).notNull(),
    origin: text("origin", {
      enum: ["ui", "mcp", "webhook", "system"],
    }).notNull(),
    action: text("action").notNull(),
    args: jsonb("args").notNull().default({}).$type<HistoryArgs>(),
    result: text("result", { enum: ["ok", "error", "refused"] }).notNull(),
    detail: jsonb("detail").$type<Record<string, string>>(),
    // What a sync_issue (decisions 002 and 020 H) or a prepare_repo (decision 027 E) did on GitHub; the pull request is its number, null when the commit went to the default branch.
    githubEffects: jsonb("github_effects").$type<
      | { issueNumber: number; created: boolean; closed: boolean }
      | { commitSha: string; pullRequest: number | null }
    >(),
  },
  (t) => [
    check(
      "history_actor_check",
      sql`${t.actor} in ('human', 'claude', 'github', 'system')`,
    ),
    check(
      "history_origin_check",
      sql`${t.origin} in ('ui', 'mcp', 'webhook', 'system')`,
    ),
    check(
      "history_result_check",
      sql`${t.result} in ('ok', 'error', 'refused')`,
    ),
  ],
);

/** What GitHub delivered at /api/webhooks/github, recorded before any processing (decisions 008 and 024 C). Purged after 30 days. */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  // The X-GitHub-Delivery header: GitHub resends a delivery with the same one.
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  action: text("action"),
  installationId: bigint("installation_id", { mode: "number" }),
  repoId: bigint("repo_id", { mode: "number" }),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  // Null: still to process (decision 025 A).
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }),
  // The reservation of a pass (a claim older than a minute is a pass that died), and the failures so far (decision 025 A).
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
  attempts: integer("attempts").notNull().default(0),
});

/** Ids, closed values and numbers only: never free text or personal data (decision 010 D). */
export type HistoryArgs = Record<string, string | number | boolean | null>;
