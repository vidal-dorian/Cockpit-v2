import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { openTestDatabase } from "./db/test-db.ts";
import { stubGitHub } from "./test-github.ts";
import {
  configureTestInstance,
  TEST_KEY,
  testAppOptions,
} from "./test-instance.ts";

// Decision 006: Claude Code listens on a free loopback port each time (RFC 8252 7.3), so a loopback redirect_uri
// matches the document on any port. The other redirect rules are in oauth.test.ts.

const CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";

async function authorize(listed: string, requested: string) {
  stubGitHub({ account: null });
  const db = await openTestDatabase();
  await configureTestInstance(db, TEST_KEY);
  const app = createApp(db, "1.2.3", {
    ...testAppOptions,
    fetchClientMetadata: vi.fn(async () =>
      Response.json({ client_id: CLIENT_ID, redirect_uris: [listed] }),
    ),
  });
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: requested,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
  });
  return app.request(`/oauth/authorize?${query}`);
}

describe("loopback redirect_uri", () => {
  it.each([
    ["http://localhost/callback", "http://localhost:60000/callback", 302],
    ["http://127.0.0.1/callback", "http://127.0.0.1:8123/callback", 302],
    ["http://localhost/callback", "http://localhost:60000/other", 400],
    ["http://localhost/callback", "http://127.0.0.1:60000/callback", 400],
    ["https://claude.ai/cb", "https://claude.ai:8443/cb", 400],
  ])(
    "given the document lists %s, when %s is requested, then %i",
    async (listed, requested, status) => {
      expect((await authorize(listed, requested)).status).toBe(status);
    },
  );
});
