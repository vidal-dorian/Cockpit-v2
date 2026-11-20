import { Hono } from "hono";
import { currentUser } from "./auth.ts";
import {
  catalogStates,
  readCatalogFiles,
  recordedHashes,
} from "./catalog-update.ts";
import type { Db } from "./db/db.ts";
import {
  alertsLine,
  catalogLine,
  type HealthLine,
  healthLines,
  updatesLine,
  webhookLine,
} from "./health.ts";
import type { Env, GitHub } from "./project-writes.ts";
import { memberProject, unauthorized } from "./projects.ts";

export function healthRoutes(
  db: Db,
  healthCacheSize: number,
  now: () => number,
) {
  // Decision 013: the health lines of the repos shown lately, by installation and repo, with the commit they were computed from. Least recently used out first (a Map keeps insertion order).
  type HealthEntry = {
    etag: string;
    commitSha: string;
    /** The address the lines were judged against (decision 023 C). */
    publicUrl: string;
    lines: HealthLine[];
    /** Kept apart: it comes after the lines that are read on each display (decision 052). */
    updates: HealthLine;
  };
  const healthCache = new Map<string, HealthEntry>();
  const remember = (key: string, entry: HealthEntry) => {
    healthCache.delete(key);
    healthCache.set(key, entry);
    for (const oldest of healthCache.keys()) {
      if (healthCache.size <= healthCacheSize) break;
      healthCache.delete(oldest);
    }
  };

  // Decision 024 F: the App's webhook reads are the same for every project, so they are kept one minute, apart from the per-commit cache above. Only successful reads are kept.
  let hook: { at: number; read: Awaited<ReturnType<GitHub["readWebhook"]>> };
  const readWebhook = async (github: GitHub) => {
    if (hook && now() - hook.at <= 60_000) return hook.read;
    try {
      hook = { at: now(), read: await github.readWebhook() };
      return hook.read;
    } catch (error) {
      console.error("GitHub webhook read failed:", error);
      return null;
    }
  };
  return new Hono<Env>().get("/api/projects/:id/health", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json(unauthorized, 401);
    const project = await memberProject(
      db,
      user.userId,
      Number(c.req.param("id")),
    );
    if (!project) return c.json({ error: "Not found" }, 404);
    // The root (the commit of HEAD) is read on each call; the rest only when it changed (decision 013). A failure leaves the cache as it was.
    const key = `${project.installationId}/${project.fullName}`;
    const publicUrl = c.get("publicUrl");
    const found = healthCache.get(key);
    // Lines judged against another address are not valid any more.
    const cached = found?.publicUrl === publicUrl ? found : undefined;
    // The lines that are not part of the cache: what GitHub says now (decisions 024 F and 052 B).
    const alerts = async () => {
      try {
        return alertsLine(
          await c.get("github").readAppAccess(project.installationId),
          c.get("appSettingsUrl"),
        );
      } catch (error) {
        console.error("GitHub permissions read failed:", error);
        return alertsLine(null, c.get("appSettingsUrl"));
      }
    };
    const live = async () => {
      const [hook, access] = await Promise.all([webhook(), alerts()]);
      return [hook, access];
    };
    const webhook = async () =>
      webhookLine(
        await readWebhook(c.get("github")),
        publicUrl,
        c.get("appSettingsUrl"),
      );
    try {
      const read = await c
        .get("github")
        .readRepoFiles(project.installationId, project.fullName, cached);
      if (!read) return c.json({ error: "repo_unreachable" }, 409);
      if (read.unchanged) {
        // Only asked for with a cached entry, so there is one.
        const entry = { ...(cached as HealthEntry), etag: read.etag };
        remember(key, entry);
        return c.json({
          lines: [...entry.lines, ...(await live()), entry.updates],
        });
      }
      const lines = healthLines(read.files, publicUrl);
      const updates = updatesLine(read.files);
      // Only a prepared repo has the line (decision 049 E); its files are read at the commit the health was computed from (H).
      if (read.files.devUsSkill.includes("SKILL.md")) {
        const { inspect } = await c
          .get("github")
          .fileReader(project.installationId, project.fullName);
        const states = catalogStates({
          files: await readCatalogFiles(inspect, read.commitSha),
          recorded: await recordedHashes(db, project.id),
        });
        if (states) lines.push(catalogLine(states));
      }
      // An empty repository has no ETag: nothing to remember.
      if (read.etag)
        remember(key, {
          etag: read.etag,
          commitSha: read.commitSha,
          publicUrl,
          lines,
          updates,
        });
      return c.json({ lines: [...lines, ...(await live()), updates] });
    } catch (error) {
      console.error("GitHub request failed:", error);
      return c.json({ error: "github_unavailable" }, 502);
    }
  });
}
