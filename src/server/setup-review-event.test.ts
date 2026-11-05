import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { testAppOptions } from "./test-instance.ts";

// Slice 7.6 (decision 038 C): the App created by the wizard also listens to the reviews of a PR.

describe("criterion 6: the manifest of the App", () => {
  it("given the right start code, when the wizard starts, then default_events has pull_request_review next to the events of 012", async () => {
    const db = await openTestDatabase();
    const app = createApp(db, "1.2.3", testAppOptions);

    const res = await app.request("/api/setup/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-visitor": '{"scheme":"https"}',
        host: "cockpit.example.com",
      },
      body: JSON.stringify({ code: testAppOptions.setupCode }),
    });

    const { manifest } = (await res.json()) as {
      manifest: { default_events: string[] };
    };
    expect(manifest.default_events).toEqual(
      expect.arrayContaining([
        "issues",
        "pull_request",
        "pull_request_review",
        "check_suite",
        "status",
        "workflow_run",
      ]),
    );
  });
});
