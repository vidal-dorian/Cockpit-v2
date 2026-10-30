import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Db } from "./db/db.ts";
import {
  history,
  projectMembers,
  projects,
  webhookDeliveries,
} from "./db/schema.ts";
import { type ReadInstance, WEBHOOK_PATH } from "./instance.ts";
import { NOT_CONFIGURED } from "./projects.ts";

// GitHub's own limit on a delivery; the 256 KiB of the other /api/* routes does not apply here (decision 024 A).
const MAX_BODY = 25 * 1024 * 1024;
const SIGNATURE = /^sha256=([0-9a-f]{64})$/;
const EVENT = /^[a-z_]{1,64}$/;
const MAX_DELIVERY_ID = 100;

// An id of the body; a safe integer, so the bigint column of the table can hold it.
const idOf = z.object({ id: z.int().safe() });
const idIn = (value: unknown) => idOf.safeParse(value).data?.id ?? null;

/** Receives GitHub's deliveries: verified on the raw bytes, then recorded with their history entry, never processed here (decision 024). */
export function webhookRoutes(db: Db, readInstance: ReadInstance) {
  return new Hono().post(
    WEBHOOK_PATH,
    bodyLimit({ maxSize: MAX_BODY }),
    async (c) => {
      const settings = await readInstance();
      if (!settings) return c.json({ error: NOT_CONFIGURED }, 503);

      // A missing or malformed signature is refused before the body is read: a scanner cannot make Cockpit buffer 25 MiB for free.
      const sent = SIGNATURE.exec(
        c.req.header("x-hub-signature-256") ?? "",
      )?.[1];
      if (!sent) {
        console.error("Webhook refused: missing or wrong signature");
        return c.json({ error: "Unauthorized" }, 401);
      }
      // The raw bytes, read once: the signature is over them, not over a re-serialisation.
      const raw = Buffer.from(await c.req.arrayBuffer());
      const expected = createHmac("sha256", settings.githubWebhookSecret)
        .update(raw)
        .digest();
      if (!timingSafeEqual(Buffer.from(sent, "hex"), expected)) {
        console.error("Webhook refused: missing or wrong signature");
        return c.json({ error: "Unauthorized" }, 401);
      }

      const id = c.req.header("x-github-delivery") ?? "";
      const event = c.req.header("x-github-event") ?? "";
      let body: unknown;
      try {
        // jsonb refuses NUL and lone surrogates, which GitHub's text (an issue body) may carry: replaced, so the delivery is still recorded.
        body = JSON.parse(raw.toString("utf8"), (_key, value) =>
          typeof value === "string"
            ? value.replaceAll("\0", "\uFFFD").toWellFormed()
            : value,
        );
      } catch {
        body = null;
      }
      if (
        id.length < 1 ||
        id.length > MAX_DELIVERY_ID ||
        !EVENT.test(event) ||
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body)
      )
        return c.json({ error: "Bad request" }, 400);

      const payload = body as Record<string, unknown>;
      const action = typeof payload.action === "string" ? payload.action : null;
      const repoId = idIn(payload.repository);
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(webhookDeliveries)
          .values({
            id,
            event,
            action,
            installationId: idIn(payload.installation),
            repoId,
            payload,
          })
          .onConflictDoNothing()
          .returning({ id: webhookDeliveries.id });
        // Already received: GitHub sent it again, nothing more to write.
        if (inserted.length === 0) return;
        const [project] =
          repoId === null
            ? []
            : await tx
                .select({ id: projects.id, userId: projectMembers.userId })
                .from(projects)
                .innerJoin(
                  projectMembers,
                  eq(projectMembers.projectId, projects.id),
                )
                .where(eq(projects.githubRepoId, repoId));
        await tx.insert(history).values({
          userId: project?.userId ?? null,
          projectId: project?.id ?? null,
          actor: "github",
          origin: "webhook",
          action: "receive_webhook",
          args: { deliveryId: id, event, action },
          result: "ok",
        });
      });
      return c.body(null, 202);
    },
  );
}
