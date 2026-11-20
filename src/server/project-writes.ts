import type { Context } from "hono";
import { act, type Entry, Refused, type Tx } from "./action.ts";
import type { Db } from "./db/db.ts";
import type { githubClient } from "./github.ts";
import { memberProject } from "./projects.ts";

export type GitHub = ReturnType<typeof githubClient>;
export type Repo = { installationId: number; fullName: string };
/** A refusal code to answer 409 and record, asked with the repo to write; it reads GitHub, so a failure is a 502. */
export type Refuse = (
  repo: Repo,
) => Promise<string | { error: string; at?: string } | null>;
export type Env = {
  Variables: {
    github: GitHub;
    installUrl: string;
    appSettingsUrl: string;
    publicUrl: string;
  };
};

export function projectWrites(db: Db) {
  const record = async (entry: Entry, error: unknown) => {
    try {
      await act(db, entry, async () => {
        throw error;
      });
    } catch (thrown) {
      if (thrown !== error) throw thrown;
    }
  };

  // The commit of the changes in a repo by a human (decisions 030 E, 031 H, 066 E): the part of `saveFile` that does not depend on a project.
  const writeChanges = async (
    c: Context<Env, string>,
    entry: Entry & { userId: number },
    /** The repo to write, or the refusal code when there is none; it may read GitHub, so a failure is a 502. */
    repo: () => Promise<Repo | string>,
    changes: { path: string; before: string | null; after: string | null }[],
    message: string,
    hooks: {
      refuse?: Refuse;
      /** Run in the transaction of the `ok` entry. */
      onWritten?: (tx: Tx) => Promise<void>;
    } = {},
  ) => {
    let result: Awaited<ReturnType<GitHub["applyRepoChanges"]>>;
    try {
      const target = await repo();
      const code =
        typeof target === "string" ? target : await hooks.refuse?.(target);
      if (code) {
        const refusal = typeof code === "string" ? { error: code } : code;
        await record(entry, new Refused(refusal.error));
        return c.json(refusal, 409);
      }
      result = await c
        .get("github")
        .applyRepoChanges(
          (target as Repo).installationId,
          (target as Repo).fullName,
          changes,
          message,
        );
    } catch (error) {
      await record(entry, error);
      return c.json({ error: "github_unavailable" }, 502);
    }
    if ("refused" in result) {
      await record(entry, new Refused(result.refused));
      return result.refused === "pull_request_forbidden"
        ? c.json(
            {
              error: result.refused,
              appSettingsUrl: c.get("appSettingsUrl"),
            },
            409,
          )
        : c.json({ error: result.refused }, 409);
    }
    await act(
      db,
      {
        ...entry,
        githubEffects: {
          commitSha: result.commitSha,
          pullRequest: result.pullRequest?.number ?? null,
        },
      },
      async (tx) => {
        await hooks.onWritten?.(tx);
      },
    );
    return c.json({
      commitSha: result.commitSha,
      changed: result.changed,
      ...(result.pullRequest && { pullRequest: result.pullRequest }),
    });
  };

  // The write of one file of the repo by a human, as the agent and team editors do it (decisions 030 E, 031 H).
  const saveFile = async (
    c: Context<Env, string>,
    entry: Entry & { userId: number },
    changes: { path: string; before: string | null; after: string | null }[],
    message: string,
    hooks: {
      /** Whether the request is valid for this project, asked once it is known to be the member's and not archived: no, and it is a 400. */
      valid?: (projectId: number) => Promise<boolean>;
      /** Run in the transaction of the `ok` entry. */
      onWritten?: (tx: Tx, projectId: number) => Promise<void>;
      refuse?: Refuse;
    } = {},
  ) => {
    const id = Number(c.req.param("id"));
    const project = await memberProject(db, entry.userId, id, "owner");
    if (!project) {
      await record(entry, new Refused("not_found"));
      return c.json({ error: "Not found" }, 404);
    }
    entry.projectId = id;
    if (project.archivedAt) {
      await record(entry, new Refused("project_archived"));
      return c.json({ error: "project_archived" }, 409);
    }
    if (hooks.valid && !(await hooks.valid(id)))
      return c.json({ error: "Bad request" }, 400);
    return writeChanges(c, entry, async () => project, changes, message, {
      refuse: hooks.refuse,
      onWritten: (tx) => hooks.onWritten?.(tx, id) ?? Promise.resolve(),
    });
  };

  return { record, writeChanges, saveFile };
}
