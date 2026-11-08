import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
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

/** The « Lanceur Cockpit » task of a user (decision 054 C): same shape as `writeUsRoutines`, the token is encrypted and never leaves the server. */
export const cloudLaunchers = pgTable("cloud_launchers", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id),
  fireUrl: text("fire_url").notNull(),
  token: text("token").notNull(),
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
    // Ticked by this user once the repo is added to their cloud launcher (decision 054 D).
    inLauncher: boolean("in_launcher").notNull().default(false),
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

/** The SHA-256 of each catalogue file Cockpit wrote into a project's repo, to tell an untouched copy from a hand-modified one (decision 049 A). */
export const catalogWrites = pgTable(
  "catalog_writes",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    path: text("path").notNull(),
    sha256: text("sha256").notNull(),
    writtenAt: timestamp("written_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("catalog_writes_project_path_idx").on(t.projectId, t.path),
  ],
);

export const MODULE_KINDS = [
  "web",
  "api",
  "mobile",
  "library",
  "other",
] as const;

/** The map of one module (sub-project) of a project, as Claude read it at a commit (decisions 007 and 043). `data` is validated by `moduleData` (code-map.ts) on write and on read. */
export const codeMaps = pgTable(
  "code_maps",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    modulePath: text("module_path").notNull(),
    moduleName: text("module_name").notNull(),
    moduleKind: text("module_kind", { enum: MODULE_KINDS }).notNull(),
    commitSha: text("commit_sha").notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("code_maps_project_module_idx").on(t.projectId, t.modulePath),
    check(
      "code_maps_module_kind_check",
      sql`${t.moduleKind} in ('web', 'api', 'mobile', 'library', 'other')`,
    ),
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

export const STORY_KINDS = ["feature", "takeover"] as const;

export const PR_CI_STATES = ["pending", "success", "failure"] as const;
export const PR_REVIEW_STATES = ["approved", "changes_requested"] as const;

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
    // A takeover story holds the rules Claude read in existing code (decision 047 C).
    kind: text("kind", { enum: STORY_KINDS }).notNull().default("feature"),
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
    // The branch of the first run (decision 033 A); empty until a run starts.
    branch: text("branch"),
    // The pull request of the story (decision 035 A).
    prNumber: integer("pr_number"),
    // Cache of the PR as GitHub shows it (decision 038 A): null when it has no check run or no review that counts.
    prCiState: text("pr_ci_state", { enum: PR_CI_STATES }),
    prReviewState: text("pr_review_state", { enum: PR_REVIEW_STATES }),
    // The paths of a takeover PR outside the tests, 20 at most, and their total (decision 050 E): null until read.
    prAppFiles: text("pr_app_files").array(),
    prAppFilesCount: integer("pr_app_files_count"),
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
    check("user_stories_kind_check", sql`${t.kind} in ('feature', 'takeover')`),
    check(
      "user_stories_pr_ci_state_check",
      sql`${t.prCiState} in ('pending', 'success', 'failure')`,
    ),
    check(
      "user_stories_pr_review_state_check",
      sql`${t.prReviewState} in ('approved', 'changes_requested')`,
    ),
  ],
);

export const RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "stopped",
  "closed_manually",
] as const;
const STEP_STATUSES = ["running", "succeeded", "failed"] as const;

/** A run of Claude on a story (decisions 002 and 033 A); one running run per story at most. `stopRequestedAt` is filled from slice 7.5. */
export const runs = pgTable(
  "runs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    storyId: integer("story_id")
      .notNull()
      .references(() => userStories.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status", { enum: RUN_STATUSES }).notNull(),
    modelActual: text("model_actual").notNull(),
    stopRequestedAt: timestamp("stop_requested_at", {
      withTimezone: true,
      mode: "date",
    }),
    comment: text("comment"),
    summary: text("summary"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("runs_one_running_per_story_idx")
      .on(t.storyId)
      .where(sql`${t.status} = 'running'`),
    check(
      "runs_status_check",
      sql`${t.status} in ('running', 'succeeded', 'failed', 'stopped', 'closed_manually')`,
    ),
  ],
);

/** A routine of a user (decision 055 A): what Claude does, in which projects, and when Cockpit launches it. Launched through the launcher, one `cloudLaunches` row per passage. */
export const routines = pgTable("routines", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  // Written by the user and read by Claude in `get_launch`; never in `/fire` nor in the history.
  instruction: text("instruction").notNull(),
  agents: jsonb("agents").$type<string[]>().notNull(),
  projectIds: jsonb("project_ids").$type<number[]>().notNull(),
  frequency: text("frequency", {
    enum: ["on_demand", "daily", "weekly"],
  }).notNull(),
  hour: integer("hour"),
  weekday: integer("weekday"),
  timeZone: text("time_zone").notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: "date" }),
  pausedAt: timestamp("paused_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** One session asked of the launcher (decision 054 E): reserved before `/fire` is called, `result` null until it answers. A launch is of a story or of a routine (055 B). */
export const cloudLaunches = pgTable(
  "cloud_launches",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    projectId: integer("project_id").references(() => projects.id),
    storyId: integer("story_id").references(() => userStories.id),
    branch: text("branch"),
    routineId: integer("routine_id").references(() => routines.id),
    team: text("team"),
    comment: text("comment"),
    result: text("result", { enum: ["ok", "error"] }),
    sessionId: text("session_id"),
    // Only a https://claude.ai address: the page makes it a link.
    sessionUrl: text("session_url"),
    // What Claude reported (`report_launch`).
    reason: text("reason"),
    runId: integer("run_id").references(() => runs.id),
    // The end of a routine passage: `finish_launch`, `report_launch`, a failed `/fire`, or given up after two hours (decision 055 D).
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    outcome: text("outcome", { enum: ["succeeded", "failed"] }),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "cloud_launches_story_xor_routine",
      sql`(${t.storyId} is null) <> (${t.routineId} is null)`,
    ),
  ],
);

/** A question Claude asks during a run (decision 036 A); one unanswered question per run at most. */
export const questions = pgTable(
  "questions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id),
    question: text("question").notNull(),
    suggestedAnswers: jsonb("suggested_answers").$type<string[]>(),
    answer: text("answer"),
    askedAt: timestamp("asked_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("questions_one_pending_per_run_idx")
      .on(t.runId)
      .where(sql`${t.answer} is null`),
  ],
);

/** A step of a run: one agent's turn (decision 033 C). A redone step is a new row. */
export const runSteps = pgTable(
  "run_steps",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    runId: integer("run_id")
      .notNull()
      .references(() => runs.id),
    agent: text("agent").notNull(),
    status: text("status", { enum: STEP_STATUSES }).notNull(),
    summary: text("summary"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    check(
      "run_steps_status_check",
      sql`${t.status} in ('running', 'succeeded', 'failed')`,
    ),
  ],
);

export const CRITERION_RESULTS = ["passed", "failed"] as const;
export const TAKEOVER_STATES = ["pending", "kept"] as const;

/** A criterion of a story; `result`, `evidence` and `resultRunId` are the last report of Claude (decision 035 A). */
export const acceptanceCriteria = pgTable(
  "acceptance_criteria",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    storyId: integer("story_id")
      .notNull()
      .references(() => userStories.id),
    position: integer("position").notNull(),
    givenText: text("given_text").notNull(),
    whenText: text("when_text").notNull(),
    thenText: text("then_text").notNull(),
    result: text("result", { enum: CRITERION_RESULTS }),
    evidence: text("evidence"),
    resultRunId: integer("result_run_id").references(() => runs.id),
    // The rule of a takeover story (decision 047 C and D); all null for an ordinary criterion.
    summary: text("summary"),
    reasoning: text("reasoning"),
    doubt: text("doubt"),
    objectNames: text("object_names").array(),
    takeoverState: text("takeover_state", { enum: TAKEOVER_STATES }),
  },
  (t) => [
    check(
      "acceptance_criteria_result_check",
      sql`${t.result} in ('passed', 'failed')`,
    ),
    check(
      "acceptance_criteria_takeover_state_check",
      sql`${t.takeoverState} in ('pending', 'kept')`,
    ),
  ],
);

export const FINDING_KINDS = [
  "bug",
  "security",
  "architecture",
  "stack",
  "upgrade",
] as const;
export const FINDING_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
] as const;
export const FINDING_EFFORTS = ["small", "medium", "large"] as const;
export const GITHUB_ALERT_TYPES = [
  "dependabot",
  "code_scanning",
  "secret_scanning",
] as const;
export const FINDING_STATUSES = [
  "open",
  "ticketed",
  "dismissed",
  "later",
] as const;

/** What Claude found in the code of a project (decisions 007 and 051): the human triages it; `ticketed` and `ticketId` go together. */
export const findings = pgTable(
  "findings",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind", { enum: FINDING_KINDS }).notNull(),
    source: text("source", { enum: ["claude", "github"] })
      .notNull()
      .default("claude"),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    severity: text("severity", { enum: FINDING_SEVERITIES }).notNull(),
    effort: text("effort", { enum: FINDING_EFFORTS }),
    status: text("status", { enum: FINDING_STATUSES })
      .notNull()
      .default("open"),
    ticketId: integer("ticket_id").references(() => tickets.id),
    dismissReason: text("dismiss_reason"),
    // Null for a finding of GitHub that cites no commit (a Dependabot alert).
    commitSha: text("commit_sha"),
    // Decision 052 G: the alert a finding of GitHub comes from; `githubClosedAt` is when it was found closed on GitHub (the status never moves).
    githubAlertType: text("github_alert_type", { enum: GITHUB_ALERT_TYPES }),
    githubAlertNumber: integer("github_alert_number"),
    githubClosedAt: timestamp("github_closed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "findings_github_check",
      sql`(${t.source} = 'github') = (${t.githubAlertType} is not null and ${t.githubAlertNumber} is not null) and (${t.githubAlertType} is null) = (${t.githubAlertNumber} is null)`,
    ),
    check(
      "findings_commit_check",
      sql`${t.source} = 'github' or ${t.commitSha} is not null`,
    ),
    uniqueIndex("findings_github_alert_idx").on(
      t.projectId,
      t.githubAlertType,
      t.githubAlertNumber,
    ),
    check(
      "findings_ticket_check",
      sql`(${t.status} = 'ticketed') = (${t.ticketId} is not null)`,
    ),
    index("findings_project_idx").on(t.projectId),
  ],
);

/** The lines of code a rule or a finding cites (exactly one of the two), verified on GitHub at `commitSha` when it was written (decisions 047 C and 051 C). */
export const codeSources = pgTable(
  "code_sources",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    criterionId: integer("criterion_id").references(
      () => acceptanceCriteria.id,
      { onDelete: "cascade" },
    ),
    findingId: integer("finding_id").references(() => findings.id, {
      onDelete: "cascade",
    }),
    // From 0, in the order of the rule.
    position: integer("position").notNull(),
    path: text("path").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    commitSha: text("commit_sha").notNull(),
  },
  (t) => [
    check("code_sources_lines_check", sql`${t.startLine} <= ${t.endLine}`),
    check("code_sources_start_check", sql`${t.startLine} >= 1`),
    check(
      "code_sources_owner_check",
      sql`(${t.criterionId} is null) <> (${t.findingId} is null)`,
    ),
    index("code_sources_finding_idx").on(t.findingId),
    index("code_sources_criterion_idx").on(t.criterionId),
    index("code_sources_commit_path_idx").on(t.commitSha, t.path),
  ],
);

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
    // The run of a run tool (decision 033 A); no foreign key, like the other ids.
    runId: integer("run_id"),
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
    // The journal (newest first, per user) and the retry lookup (same user, action, later at) of decision 053.
    index("history_user_at_idx").on(t.userId, t.at.desc(), t.id.desc()),
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
type HistoryArgs = Record<string, string | number | boolean | null>;
