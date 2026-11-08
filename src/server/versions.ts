import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { currentUser } from "./auth.ts";
import { moduleData } from "./code-map.ts";
import type { Db } from "./db/db.ts";
import { codeMaps } from "./db/schema.ts";
import { memberProject } from "./projects.ts";

export type FetchEndOfLife = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

const READ_TIMEOUT_MS = 5_000;
const CACHE_MS = 86_400_000;
const SOON_MONTHS = 6;
// Decision 052 I: the names a runtime has on endoflife.date when it is not its own lowercase.
const ALIASES: Record<string, string> = {
  node: "nodejs",
  ".net": "dotnet",
  "vue.js": "vue",
  postgres: "postgresql",
  "spring boot": "spring-boot",
  "ruby on rails": "rails",
};

const releasesSchema = z.object({
  result: z.object({
    releases: z.array(
      z.object({
        name: z.string(),
        isEol: z.boolean().nullish(),
        eolFrom: z.string().nullish(),
      }),
    ),
  }),
});
type Release = z.infer<typeof releasesSchema>["result"]["releases"][number];

/** The end of life of the runtimes of the map, read on endoflife.date and kept in memory (decision 052 I). */
export function versionRoutes(
  db: Db,
  fetchEndOfLife: FetchEndOfLife,
  now: () => number,
) {
  // shortcut: in memory, one instance only; move it to the database with the other caches when Cockpit runs on several (architecture, « Montée en charge »).
  // `null` is a product endoflife.date does not know, which is kept too.
  const cache = new Map<string, { at: number; releases: Release[] | null }>();

  /** The releases of a product; null when unknown, undefined when the site failed (never kept). */
  const readProduct = async (product: string) => {
    const kept = cache.get(product);
    if (kept && now() - kept.at < CACHE_MS) return kept.releases;
    try {
      const res = await fetchEndOfLife(
        `https://endoflife.date/api/v1/products/${encodeURIComponent(product)}`,
        { signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
      );
      if (res.status !== 200 && res.status !== 404) return undefined;
      const releases =
        res.status === 404
          ? null
          : releasesSchema.parse(await res.json()).result.releases;
      cache.set(product, { at: now(), releases });
      return releases;
    } catch (error) {
      console.error(`endoflife.date read failed for ${product}:`, error);
      return undefined;
    }
  };

  const stateOf = (release: Release) => {
    const from = release.eolFrom ? Date.parse(release.eolFrom) : Number.NaN;
    if (release.isEol || from <= now()) return "eol";
    const soon = new Date(now());
    soon.setUTCMonth(soon.getUTCMonth() + SOON_MONTHS);
    return from <= soon.getTime() ? "soon" : "ok";
  };

  return new Hono().get("/api/projects/:id/versions", async (c) => {
    const user = await currentUser(db, c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const project = await memberProject(
      db,
      user.userId,
      Number(c.req.param("id")),
    );
    if (!project) return c.json({ error: "Not found" }, 404);
    const runtimes = (
      await db
        .select()
        .from(codeMaps)
        .where(eq(codeMaps.projectId, project.id))
        .orderBy(asc(codeMaps.modulePath))
    ).flatMap((row) => {
      const data = moduleData.safeParse(row.data);
      if (!data.success) {
        console.error(
          `Stored code map ${row.modulePath} is corrupt:`,
          data.error,
        );
        return [];
      }
      return data.data.runtimes.map((r) => {
        const lower = r.name.trim().toLowerCase();
        return {
          module: { path: row.modulePath, name: row.moduleName },
          name: r.name,
          version: r.version,
          product: ALIASES[lower] ?? lower,
          source: {
            path: r.citation.path,
            startLine: r.citation.start_line,
            endLine: r.citation.end_line,
            commitSha: row.commitSha,
          },
        };
      });
    });
    // One read per product, not per runtime.
    const products = new Map(
      await Promise.all(
        [...new Set(runtimes.map((r) => r.product))].map(
          async (product) => [product, await readProduct(product)] as const,
        ),
      ),
    );
    return c.json({
      runtimes: runtimes.map((r) => {
        const number = /\d+(?:\.\d+)?/.exec(r.version)?.[0];
        const releases = products.get(r.product);
        const release =
          number === undefined
            ? undefined
            : (releases?.find((x) => x.name === number) ??
              releases?.find((x) => x.name === number.split(".")[0]));
        return {
          ...r,
          cycle: release?.name ?? null,
          state: release ? stateOf(release) : "unknown",
          eolFrom: release?.eolFrom ?? null,
        };
      }),
    });
  });
}
