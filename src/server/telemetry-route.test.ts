import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Decision 083 B: the page asks for the PostHog key before it knows who is logged in.
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY, {
    publicUrl: "http://localhost:3000",
  });
  app = createApp(db, "1.2.3", testAppOptions);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/telemetry", () => {
  it("given POSTHOG_KEY is not set, when GET /api/telemetry is called, then 200 with { key: null }", async () => {
    vi.stubEnv("POSTHOG_KEY", undefined);

    const res = await app.request("/api/telemetry");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: null });
  });

  it('given POSTHOG_KEY is phc_test, when GET /api/telemetry is called without being logged in, then 200 with { key: "phc_test" }', async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");

    const res = await app.request("/api/telemetry");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: "phc_test" });
  });
});
