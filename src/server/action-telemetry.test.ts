import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, Refused } from "./action.ts";
import { history } from "./db/schema.ts";
import { openTestDatabase } from "./db/test-db.ts";

// Decision 083 E and G: every action of `act` reaches PostHog from the server, without args, detail or error message.
const URL = "https://eu.i.posthog.com/i/v0/e/";

const entry = {
  userId: 7,
  actor: "human",
  origin: "ui",
  action: "ticket.close",
  args: { ticket: 17, status: "done" },
} as const;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("POSTHOG_KEY", "phc_test");
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The one event sent, once the call (not awaited by act) has happened. */
async function sentEvent() {
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(URL);
  expect(init.method).toBe("POST");
  return { init, body: JSON.parse(String(init.body)) };
}

describe("act sends its action to PostHog", () => {
  it("given POSTHOG_KEY is not set, when an action goes through act(), then no request is made to PostHog", async () => {
    vi.stubEnv("POSTHOG_KEY", undefined);
    const db = await openTestDatabase();

    await act(db, entry, async () => {});
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(history)).toHaveLength(1);
  });

  it("given POSTHOG_KEY is set, when user 7 succeeds an action from the interface, then exactly one POST goes to PostHog with api_key, event, distinct_id and the properties result, actor and origin, without reason", async () => {
    const db = await openTestDatabase();

    await act(db, entry, async () => {});

    const { body } = await sentEvent();
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "ticket.close",
      distinct_id: "7",
      properties: { result: "ok", actor: "human", origin: "ui" },
    });
    expect(body.properties).not.toHaveProperty("reason");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("given POSTHOG_KEY is set, when an action is refused with code no_session, then the event has result refused and reason no_session", async () => {
    const db = await openTestDatabase();

    await expect(
      act(db, entry, async () => {
        throw new Refused("no_session");
      }),
    ).rejects.toBeInstanceOf(Refused);

    const { body } = await sentEvent();
    expect(body.properties).toMatchObject({
      result: "refused",
      reason: "no_session",
    });
  });

  it("given POSTHOG_KEY is set, when an action fails on an unexpected error, then the event has result error and reason error, without the error's message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await openTestDatabase();

    await expect(
      act(db, entry, async () => {
        throw new Error("secret boom for Jean Dupont");
      }),
    ).rejects.toThrow();

    const { init, body } = await sentEvent();
    expect(body.properties).toMatchObject({ result: "error", reason: "error" });
    expect(String(init.body)).not.toContain("secret boom");
    expect(String(init.body)).not.toContain("Jean Dupont");
  });

  it("given POSTHOG_KEY is set, when an action without a user is written (a login refusal), then the event has distinct_id server and $process_person_profile false", async () => {
    const db = await openTestDatabase();

    await act(
      db,
      { ...entry, userId: null as unknown as number },
      async () => {},
    );

    const { body } = await sentEvent();
    expect(body.distinct_id).toBe("server");
    expect(body.properties.$process_person_profile).toBe(false);
  });

  it("given POSTHOG_KEY is set, when an action with args and a detail goes through act(), then the body sent contains neither the args nor the detail", async () => {
    const db = await openTestDatabase();
    const withDetail = {
      ...entry,
      args: { ticket: 424242, status: "ARGS-MARKER" },
      detail: { note: "DETAIL-MARKER" },
    };

    await act(db, withDetail, async () => {});

    const [row] = await db.select().from(history);
    expect(row?.detail).toEqual({ note: "DETAIL-MARKER" });
    const { init } = await sentEvent();
    const sent = String(init.body);
    expect(sent).not.toContain("ARGS-MARKER");
    expect(sent).not.toContain("424242");
    expect(sent).not.toContain("DETAIL-MARKER");
    expect(sent).not.toContain('"args"');
    expect(sent).not.toContain('"detail"');
  });
});

describe("PostHog is slow or down", () => {
  const withinTwoSeconds = <T>(promise: Promise<T>) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("act waited for PostHog")), 2000),
      ),
    ]);

  it.each([
    ["answers 500", () => new Response("down", { status: 500 })],
    [
      "fails on a network error",
      () => Promise.reject(new TypeError("fetch failed")),
    ],
  ])(
    "given PostHog %s, when an action goes through act(), then the action returns normally, its history entry is written and the failure only appears in the server logs",
    async (_name, answer) => {
      fetchMock.mockImplementation(async () => answer());
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const db = await openTestDatabase();

      const result = await withinTwoSeconds(act(db, entry, async () => "done"));

      expect(result).toBe("done");
      const rows = await db.select().from(history);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ result: "ok" });
      await vi.waitFor(() =>
        expect(
          error.mock.calls.length + warn.mock.calls.length,
        ).toBeGreaterThan(0),
      );
    },
  );

  it("given PostHog never answers, when an action goes through act(), then the action returns without waiting, its history entry is written and the request is abortable (10 s timeout)", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const db = await openTestDatabase();

    const result = await withinTwoSeconds(act(db, entry, async () => "done"));

    expect(result).toBe("done");
    expect(await db.select().from(history)).toHaveLength(1);
    const { init } = await sentEvent();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
