import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Decision 083 F: the api client reports failed calls as api_error, through src/web/telemetry.ts, and hands the response back unchanged.
// Assumed surface of src/web/telemetry.ts: init(key: string | null), track(event, props), identify(id: string), captureException(error).
const ph = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: ph }));

const UUID = "3f2b8c1e-5d4a-4e9b-8a77-0c1d2e3f4a5b";

/** The api client on fresh modules, with telemetry started with `key`, over a fetch that answers `answer`. */
async function load(key: string | null, answer: () => Promise<Response>) {
  vi.resetModules();
  const fetchMock = vi.fn(answer);
  vi.stubGlobal("fetch", fetchMock);
  const { init } = await import("./telemetry.ts");
  init(key);
  const { client } = await import("./api.ts");
  return client;
}

const apiErrors = () =>
  ph.capture.mock.calls.filter(([event]) => event === "api_error");

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api_error", () => {
  it("given telemetry is active, when a call to /api/projects/12/tickets gets a 503 response, then an api_error event is captured with route /api/projects/:id/tickets and status 503, and the caller gets the 503 response unchanged", async () => {
    const client = await load("phc_test", async () =>
      Response.json({ error: "down" }, { status: 503 }),
    );

    const res = await client.api.projects[":id"].tickets.$get({
      param: { id: "12" },
      query: {},
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "down" });
    expect(apiErrors()).toEqual([
      ["api_error", { route: "/api/projects/:id/tickets", status: 503 }],
    ]);
  });

  it("given telemetry is active, when a call whose path holds a UUID gets a 500 response, then the route of the api_error event has :id instead of the UUID", async () => {
    const client = await load("phc_test", async () =>
      Response.json({ error: "boom" }, { status: 500 }),
    );

    await client.api.tickets[":id"].$get({ param: { id: UUID } });

    expect(apiErrors()).toEqual([
      ["api_error", { route: "/api/tickets/:id", status: 500 }],
    ]);
    expect(JSON.stringify(ph.capture.mock.calls)).not.toContain(UUID);
  });

  it("given telemetry is active, when a call fails on a network error, then an api_error event is captured with status 0, and the caller gets the same error", async () => {
    const failure = new TypeError("Failed to fetch");
    const client = await load("phc_test", () => Promise.reject(failure));

    await expect(
      client.api.tickets[":id"].$get({ param: { id: "5" } }),
    ).rejects.toBe(failure);

    expect(apiErrors()).toEqual([
      ["api_error", { route: "/api/tickets/:id", status: 0 }],
    ]);
  });

  it.each([401, 403, 404])(
    "given telemetry is active, when a call gets a %i response, then no api_error event is captured",
    async (status) => {
      const client = await load("phc_test", async () =>
        Response.json({ error: "no" }, { status }),
      );

      const res = await client.api.tickets[":id"].$get({
        param: { id: "5" },
      });

      expect(res.status).toBe(status);
      // The client must have gone through telemetry at all: a 500 on the same wiring is captured.
      expect(ph.init).toHaveBeenCalled();
      expect(apiErrors()).toEqual([]);
    },
  );

  it("given telemetry is not configured, when a call gets a 503, then nothing is sent to PostHog and the caller gets the response", async () => {
    const client = await load(null, async () =>
      Response.json({ error: "down" }, { status: 503 }),
    );

    const res = await client.api.tickets[":id"].$get({ param: { id: "5" } });

    expect(res.status).toBe(503);
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });
});
