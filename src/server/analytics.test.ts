import { describe, expect, it } from "vitest";
import { analyticsFromEnv } from "./analytics.ts";

describe("analyticsFromEnv host (decision 082 A)", () => {
  it("given an empty POSTHOG_HOST (what compose passes), then the default host is used", () => {
    expect(
      analyticsFromEnv({ POSTHOG_KEY: "phc_test", POSTHOG_HOST: "" })?.host,
    ).toBe("https://eu.i.posthog.com");
  });

  it.each([
    "posthog.example.org",
    "ftp://posthog.example.org",
    "javascript:alert(1)",
  ])(
    "given POSTHOG_HOST=%s, then the start-up fails with a clear error",
    (host) => {
      expect(() =>
        analyticsFromEnv({ POSTHOG_KEY: "phc_test", POSTHOG_HOST: host }),
      ).toThrow(/POSTHOG_HOST must be an http\(s\) URL/);
    },
  );
});
