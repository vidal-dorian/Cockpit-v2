import type { Db } from "./db/db.ts";
import { history } from "./db/schema.ts";

/** The history entry of an action; `args` hold ids, closed values and numbers, never free text or personal data (decision 010 D). */
export type Entry = Required<
  Pick<
    typeof history.$inferInsert,
    "userId" | "actor" | "origin" | "action" | "args"
  >
> &
  Pick<
    typeof history.$inferInsert,
    "projectId" | "ticketId" | "storyId" | "runId" | "tokenId" | "githubEffects"
  >;

/** The work was not allowed; `act` records a `refused` entry. The message goes to the history, so it must be a fixed code: no free text, nothing personal. */
export class Refused extends Error {
  /** Set by `act` once the `refused` entry is written, so a caller up the stack does not write it again. */
  journaled = false;
}

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The only way to run a business action: `work` and its `ok` entry share one
 * transaction. If `work` throws, nothing is applied and a `refused` or `error`
 * entry is written on its own; the error is rethrown.
 * Call it with the root `db`, never a transaction: nested, it would become a
 * savepoint and the error entry would be rolled back with it.
 */
export async function act<T>(
  db: Db,
  entry: Entry,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      const result = await work(tx);
      await tx.insert(history).values({ ...entry, result: "ok" });
      return result;
    });
  } catch (error) {
    // An error's message may carry SQL parameters or third-party text: the history only gets a closed value, the log gets the rest.
    if (!(error instanceof Refused))
      console.error(`Action ${entry.action} failed:`, error);
    try {
      await db.insert(history).values({
        ...entry,
        result: error instanceof Refused ? "refused" : "error",
        detail: { reason: error instanceof Refused ? error.message : "error" },
      });
    } catch (writeError) {
      console.error(`Action ${entry.action} left no history entry:`, error);
      throw writeError;
    }
    if (error instanceof Refused) error.journaled = true;
    throw error;
  }
}
