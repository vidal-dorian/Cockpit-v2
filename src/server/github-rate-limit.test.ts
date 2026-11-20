import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubClient } from "./github.ts";
import {
  githubAppConfig,
  githubCalls,
  INSTALLATION_ID,
} from "./test-github.ts";
import {
  deliveryRow,
  entriesOf,
  issuesPayload,
  pass,
  readInstanceOf,
  seedDelivery,
} from "./test-issue-edit.ts";
import { followed, pullRequestDelivery } from "./test-pr-follow.ts";
import { processDeliveries, scheduleDeliveries } from "./webhooks.ts";

// Ticket 42: GitHub's rate limits no longer lose events. Nothing here waits real seconds: the client tests fake the timers.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Lets the real async work (JWT signing, the token) run until GitHub has been asked `count` times; the timers are faked. */
async function untilReads(reads: () => number, count: number) {
  // The timers of node:timers/promises are not the faked globals.
  for (let i = 0; i < 200 && reads() < count; i++) await sleep(5);
}

const LIMITS = {
  "429": {},
  "403 (primary limit)": { "x-ratelimit-remaining": "0" },
  "403 (secondary limit)": {},
} as const;
const limited = (name: keyof typeof LIMITS, retryAfter: number) =>
  Response.json(
    { message: "You have exceeded a secondary rate limit." },
    {
      status: name === "429" ? 429 : 403,
      headers: { "retry-after": String(retryAfter), ...LIMITS[name] },
    },
  );

/** A GitHub that limits the first read of a PR, then answers it. Returns the number of reads of the PR. */
function stubLimitedPull(name: keyof typeof LIMITS, retryAfter: number) {
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string" ? input : (input as Request).url,
      );
      if (url.pathname.endsWith("/access_tokens"))
        return Response.json(
          {
            token: "ghs_x",
            expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          },
          { status: 201 },
        );
      reads++;
      if (reads === 1) return limited(name, retryAfter);
      return Response.json({ head: { ref: "feature", repo: null } });
    }),
  );
  return () => reads;
}

describe("criterion 1: a rate limit with Retry-After is waited out and retried", () => {
  it.each(Object.keys(LIMITS) as (keyof typeof LIMITS)[])(
    "given GitHub answers %s with Retry-After, when Cockpit makes a call, then it waits the given delay and retries, and the call succeeds",
    async (name) => {
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      const reads = stubLimitedPull(name, 2);

      const result = githubClient(githubAppConfig).readPullRequest(
        INSTALLATION_ID,
        "octocat/app",
        5,
      );
      result.catch(() => {});
      await untilReads(reads, 1);
      await vi.advanceTimersByTimeAsync(1_000);
      // Not retried before the delay.
      expect(reads()).toBe(1);
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toEqual({
        branch: "feature",
        repo: null,
      });
      expect(reads()).toBe(2);
    },
  );
});

/** The first age (seconds since the last claim) among `ages` at which a failing delivery with `attempts` is tried again, null when never. */
async function firstRetryAge(
  db: Parameters<typeof seedDelivery>[0],
  attempts: number,
  ages: number[],
) {
  for (const age of ages) {
    await db.execute(sql`delete from webhook_deliveries`);
    await seedDelivery(db, {
      event: "issues",
      action: "edited",
      repoId: 1,
      payload: issuesPayload({ number: 1, title: "t", body: "b" }),
      attempts,
      claimedAgo: age,
    });
    const readInstance = vi.fn(async () => {
      throw new Error("handler fails");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await processDeliveries(db, {
      readInstance: Object.assign(readInstance, { forget() {} }),
    });
    if (readInstance.mock.calls.length > 0) return age;
  }
  return null;
}

describe("criterion 2: the gap between two tries of a failing delivery grows", () => {
  it("given a delivery that fails for another reason, when it is tried again, then the wait after its 4th failure is longer than after its 2nd", async () => {
    const { withStory } = await import("./test-decisions.ts");
    const { db } = await withStory();
    const ages = [61, 150, 400, 1_000, 3_000, 10_000, 86_400];

    const after2 = await firstRetryAge(db, 2, ages);
    const after4 = await firstRetryAge(db, 4, ages);

    expect(after2).not.toBeNull();
    expect(after4).not.toBeNull();
    expect(after4 as number).toBeGreaterThan(after2 as number);
  });
});

/** The fake GitHub, except that reading a PR is rate limited for an hour. */
function limitPullReads(fetchMock: typeof fetch) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : (input as Request).url,
      );
      if (/\/pulls\/\d+$/.test(url.pathname)) return limited("429", 3600);
      return fetchMock(input, init);
    }),
  );
}

describe("criterion 3: a rate limit is not one of the 5 tries", () => {
  it("given a delivery whose read is rate limited, when it is processed, then its attempts do not grow and it stays pending", async () => {
    const s = await followed("in_review");
    limitPullReads(s.fetchMock as unknown as typeof fetch);
    const id = await pullRequestDelivery(s.db);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await pass(s.db);

    const row = await deliveryRow(s.db, id);
    expect(row.attempts).toBe(0);
    expect(row.processed_at).toBeNull();
  });

  it("given a delivery already at 4 tries, when a rate limit stops it again, then it is not given up on and writes no process_webhook entry", async () => {
    const s = await followed("in_review");
    limitPullReads(s.fetchMock as unknown as typeof fetch);
    const id = await pullRequestDelivery(s.db);
    await s.db.execute(
      sql`update webhook_deliveries set attempts = 4 where id = ${id}`,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    await pass(s.db);

    const row = await deliveryRow(s.db, id);
    expect(row.attempts).toBe(4);
    expect(row.processed_at).toBeNull();
    expect(await entriesOf(s.db, "process_webhook")).toEqual([]);
  });
});

/** Polls with the real clock: the scheduler's timers are faked. */
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the condition never became true");
}

describe("criterion 4: the minute pass reuses its GitHub client", () => {
  it("given the pass that runs every minute, when it reads GitHub two minutes in a row, then it asks for one installation token only", async () => {
    const s = await followed("in_review");
    vi.useFakeTimers({ toFake: ["setInterval"] });
    const first = await pullRequestDelivery(s.db);
    const tokensNow = () =>
      githubCalls(s.fetchMock).filter((call) =>
        call.path.endsWith("/access_tokens"),
      ).length;
    // The story was published with another client: only the passes count.
    const before = tokensNow();

    const timer = scheduleDeliveries(s.db, {
      readInstance: readInstanceOf(s.db),
    });
    await until(
      async () => (await deliveryRow(s.db, first)).processed_at !== null,
    );
    const second = await pullRequestDelivery(s.db);
    vi.advanceTimersByTime(60_000);
    await until(
      async () => (await deliveryRow(s.db, second)).processed_at !== null,
    );
    clearInterval(timer);

    expect(tokensNow() - before).toBe(1);
  });
});
