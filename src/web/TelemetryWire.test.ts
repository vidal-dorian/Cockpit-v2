// @vitest-environment jsdom
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

// Decision 083 D: the real posthog-js (not mocked), only `fetch` is stubbed: no request carries the real address.
afterEach(() => {
  vi.unstubAllGlobals();
});

async function text(body: unknown): Promise<string> {
  if (typeof body === "string") return body;
  const bytes = Buffer.from(await new Response(body as BodyInit).arrayBuffer());
  try {
    return gunzipSync(bytes).toString();
  } catch {
    return bytes.toString();
  }
}

describe("posthog-js on the wire", () => {
  it("given a page at /projets/12/conception?tab=x with a referrer, when init, identify and two $pageview run, then no request body holds the path, the query or the referrer, and no /flags request is made", async () => {
    vi.resetModules();
    window.history.replaceState({}, "", "/projets/12/conception?tab=x");
    Object.defineProperty(document, "referrer", {
      value: "https://github.com/acme/secret-repo",
      configurable: true,
    });
    const sent: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        sent.push({ url: String(url), body: await text(init?.body) });
        return Response.json({});
      }),
    );
    const { init, identify, track } = await import("./telemetry.ts");
    await init("phc_test");
    track("$pageview", { screen: "/projets/:id/conception" });
    window.history.replaceState({}, "", "/tickets/42");
    track("$pageview", { screen: "/tickets/:id" });
    identify("7");
    // posthog-js sends $identify at once but batches the other events a few seconds later.
    const events = () =>
      sent.flatMap(({ body }) => {
        try {
          const parsed = JSON.parse(body);
          return parsed.batch ?? [parsed];
        } catch {
          return [];
        }
      });
    await vi.waitFor(
      () =>
        expect(events().filter((e) => e.event === "$pageview")).toHaveLength(2),
      { timeout: 8000 },
    );

    expect(sent.filter((r) => r.url.includes("/flags"))).toEqual([]);
    for (const { body } of sent) {
      expect(body).not.toMatch(
        /projets\/12|tickets\/42|tab=x|secret-repo|github\.com|localhost/,
      );
    }
  }, 10_000);
});
