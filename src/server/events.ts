import { eq } from "drizzle-orm";
import type { Db } from "./db/db.ts";
import { projectMembers } from "./db/schema.ts";

type Listener = (key: string) => void;

// In memory: one instance only (decision 008). Shortcut: several instances would need LISTEN / NOTIFY (decision 033).
const listeners = new Map<number, Set<Listener>>();

/** Subscribes a session's stream to the changes of its user's projects; returns the way out. */
export function subscribe(userId: number, listener: Listener) {
  const mine = listeners.get(userId) ?? new Set<Listener>();
  mine.add(listener);
  listeners.set(userId, mine);
  return () => {
    mine.delete(listener);
    if (mine.size === 0) listeners.delete(userId);
  };
}

/** Tells the members of a project that objects changed (`run:12`, `story:42`). Call it after the transaction committed; it never fails the caller, a missed event is only a page that reloads later. */
export async function publish(db: Db, projectId: number, keys: string[]) {
  try {
    const members = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    for (const { userId } of members)
      for (const listener of listeners.get(userId) ?? [])
        for (const key of keys) listener(key);
  } catch (error) {
    console.error("Publishing a change failed:", error);
  }
}
