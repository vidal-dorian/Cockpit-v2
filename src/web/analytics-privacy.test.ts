import { afterEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: posthog }));

import { startAnalytics, stopAnalytics, stripQuery } from "./analytics.ts";

const config = { key: "k", host: "https://h.example", distinctId: "7" };
const beforeSend = () =>
  posthog.init.mock.calls[0]?.[1].before_send as (e: unknown) => unknown;

afterEach(() => {
  stopAnalytics();
  vi.clearAllMocks();
});

describe("stripQuery, every URL property (decision 082 B)", () => {
  it("given session entry URLs and $set_once / $set person properties, then their query strings and hashes are removed", () => {
    const event = stripQuery({
      event: "$identify",
      properties: {
        $session_entry_url: "https://c.example/a?path=x",
        $session_entry_referrer: "https://c.example/b?q=1#top",
        $pathname: "/a",
      },
      $set_once: {
        $initial_current_url: "https://c.example/a?path=x",
        $initial_referrer: "https://c.example/?q=1",
      },
      $set: { $current_url: "https://c.example/a?z=1", $referrer: "$direct" },
    });

    expect(event).toEqual({
      event: "$identify",
      properties: {
        $session_entry_url: "https://c.example/a",
        $session_entry_referrer: "https://c.example/b",
        $pathname: "/a",
      },
      $set_once: {
        $initial_current_url: "https://c.example/a",
        $initial_referrer: "https://c.example/",
      },
      $set: { $current_url: "https://c.example/a", $referrer: "$direct" },
    });
  });
});

describe("a measure that stops (decision 082 C)", () => {
  it("given a started measure, then identification is bootstrapped and remote features are off", async () => {
    await startAnalytics(config);

    expect(posthog.init.mock.calls[0]?.[1]).toMatchObject({
      bootstrap: { distinctID: "7", isIdentifiedID: true },
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_performance: false,
      capture_pageleave: false,
    });
  });

  it("given a stopped measure, when PostHog still captures, then before_send drops the event", async () => {
    await startAnalytics(config);
    const send = beforeSend();
    expect(send({ event: "$pageview" })).not.toBeNull();
    expect(send({ properties: { $current_url: "https://x/a?q=1#h" } })).toEqual(
      { properties: { $current_url: "https://x/a" } },
    );

    stopAnalytics();

    expect(send({ event: "$pageview" })).toBeNull();
  });

  it("given a stop before the import resolves, then nothing is initialised or identified", async () => {
    const pending = startAnalytics(config);
    stopAnalytics();
    await pending;

    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
  });
});
