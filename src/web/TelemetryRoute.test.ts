import { afterEach, expect, it, vi } from "vitest";

// Decision 083 F: the two string path params of the API never reach api_error.
const ph = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: ph }));

afterEach(() => {
  vi.unstubAllGlobals();
});

it("given failing calls with an invitation secret and a team name in the path, then api_error routes hold :secret and :name instead", async () => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({}, { status: 500 })),
  );
  const { init } = await import("./telemetry.ts");
  await init("phc_test");
  const { client } = await import("./api.ts");

  await client.api.invitations[":secret"].$get({ param: { secret: "s3cr3t" } });
  await client.api.invitations[":secret"].accept.$post({
    param: { secret: "s3cr3t" },
  });
  await client.api["agent-teams"][":name"].$delete({
    param: { name: "my-team" },
  });

  expect(ph.capture.mock.calls).toEqual([
    ["api_error", { route: "/api/invitations/:secret", status: 500 }],
    ["api_error", { route: "/api/invitations/:secret/accept", status: 500 }],
    ["api_error", { route: "/api/agent-teams/:name", status: 500 }],
  ]);
});
