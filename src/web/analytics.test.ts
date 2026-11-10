import { afterEach, describe, expect, it, vi } from "vitest";

// Decision 082 B to D: the audience measure, criteria 4 to 6 and the stripping of criterion 5.
const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthog }));

import { startAnalytics, stopAnalytics, stripQuery } from "./analytics.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("startAnalytics (decision 082, criterion 4)", () => {
  it("given an analytics answer, when the page opens, then PostHog is initialised with the key, the host and the privacy settings, then identify(distinctId) is called", async () => {
    await startAnalytics({
      key: "phc_test",
      host: "https://eu.i.posthog.com",
      distinctId: "7",
    });

    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "https://eu.i.posthog.com",
        persistence: "memory",
        capture_pageview: "history_change",
        mask_all_text: true,
        mask_all_element_attributes: true,
        disable_session_recording: true,
        disable_surveys: true,
        person_profiles: "identified_only",
        before_send: expect.any(Function),
      }),
    );
    expect(posthog.identify).toHaveBeenCalledWith("7");
    expect(posthog.init.mock.invocationCallOrder[0]).toBeLessThan(
      posthog.identify.mock.invocationCallOrder[0] as number,
    );
  });
});

describe("stripQuery (criterion 5)", () => {
  it("given an event with a query string in $current_url, $referrer and $initial_current_url, when PostHog sends it, then the query strings are removed", () => {
    const event = stripQuery({
      event: "$pageview",
      properties: {
        $current_url: "https://cockpit.example/projets/3/code?path=src/a.ts",
        $referrer: "https://cockpit.example/projets?q=x",
        $initial_current_url: "https://cockpit.example/?a=1",
        other: "kept?",
      },
    });

    expect(event?.properties).toEqual({
      $current_url: "https://cockpit.example/projets/3/code",
      $referrer: "https://cockpit.example/projets",
      $initial_current_url: "https://cockpit.example/",
      other: "kept?",
    });
  });

  it("given an event without those properties, then it is returned untouched", () => {
    const event = { event: "$autocapture", properties: { a: 1 } };
    expect(stripQuery(event)).toEqual(event);
    expect(stripQuery(null)).toBeNull();
  });
});

describe("stopAnalytics (criterion 6)", () => {
  it("given a measured person, when she logs out, then posthog.reset() is called", async () => {
    await startAnalytics({
      key: "k",
      host: "https://h.example",
      distinctId: "1",
    });

    stopAnalytics();

    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });
});
