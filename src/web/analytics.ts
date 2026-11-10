// Audience measure (decision 082): posthog-js is loaded only when the instance has a key.
import type { PostHog } from "posthog-js";

type Event = {
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
} | null;

let loaded: PostHog | undefined;
// Set by start, cleared by stop: posthog-js keeps capturing under a fresh anonymous id after reset(), so nothing leaves while nobody is identified.
let active = false;
// Bumped by every stop: a start whose import resolves after a stop does nothing.
let epoch = 0;

/** Removes the query string and the hash of every URL or referrer PostHog sends, in the event and in the person properties (decision 082 B). */
export function stripQuery<E extends Event>(event: E): E {
  for (const bag of [event?.properties, event?.$set, event?.$set_once]) {
    if (!bag) continue;
    for (const [name, value] of Object.entries(bag))
      if (typeof value === "string" && /(url|referrer)$/i.test(name))
        bag[name] = value.split(/[?#]/)[0];
  }
  return event;
}

export function startAnalytics(config: {
  key: string;
  host: string;
  distinctId: string;
}) {
  const started = epoch;
  // No guard of ours: posthog.init ignores a second call and identify is idempotent (StrictMode runs the effect twice).
  return import("posthog-js").then((module) => {
    if (started !== epoch) return;
    // The types of posthog-js declare a default that is the module itself under our module resolution.
    const posthog = module.default as unknown as PostHog;
    active = true;
    posthog.init(config.key, {
      api_host: config.host,
      persistence: "memory",
      capture_pageview: "history_change",
      // Page views and clicks only (decision 082 B): no page-leave event with its duration and scroll depth.
      capture_pageleave: false,
      mask_all_text: true,
      mask_all_element_attributes: true,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: "identified_only",
      // The person is known from the first event: no anonymous id minted and merged at every page load.
      bootstrap: { distinctID: config.distinctId, isIdentifiedID: true },
      // Nothing the PostHog project could switch on remotely: only page views and clicks.
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_performance: false,
      disable_web_experiments: true,
      disable_product_tours: true,
      disable_conversations: true,
      before_send: (event) => (active ? stripQuery(event) : null),
    });
    posthog.identify(config.distinctId);
    loaded = posthog;
  });
}

/** PostHog forgets the person and sends nothing more (decision 082 C). */
export function stopAnalytics() {
  epoch++;
  active = false;
  loaded?.reset();
  loaded = undefined;
}
