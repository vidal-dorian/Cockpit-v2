import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { openTestDatabase } from "./db/test-db.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY, {
    publicUrl: "http://localhost:3000",
  });
  app = createApp(db, "1.2.3", testAppOptions);
});

describe("GET /api/health", () => {
  it("answers ok with the version", async () => {
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: "1.2.3" });
  });
});

describe("unknown API route", () => {
  it("answers 404 in JSON instead of the page", async () => {
    const res = await app.request("/api/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
