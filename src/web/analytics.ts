// Audience measure (decision 082): posthog-js is loaded only when the instance has a key.
import type { PostHog } from "posthog-js";

type Event = { properties?: Record<string, unknown> } | null;

let loaded: PostHog | undefined;

const URLS = ["$current_url", "$referrer", "$initial_current_url"];

/** Removes the query string and the hash of the URLs PostHog sends (decision 082 B). */
export function stripQuery<E extends Event>(event: E): E {
  const properties = event?.properties;
  if (!properties) return event;
  for (const name of URLS) {
    const value = properties[name];
    if (typeof value === "string") properties[name] = value.split(/[?#]/)[0];
  }
  return event;
}

export function startAnalytics(config: {
  key: string;
  host: string;
  distinctId: string;
}) {
  // No guard of ours: posthog.init ignores a second call and identify is idempotent (StrictMode runs the effect twice).
  return import("posthog-js").then((module) => {
    // The types of posthog-js declare a default that is the module itself under our module resolution.
    const posthog = module.default as unknown as PostHog;
    posthog.init(config.key, {
      api_host: config.host,
      persistence: "memory",
      capture_pageview: "history_change",
      mask_all_text: true,
      mask_all_element_attributes: true,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: "identified_only",
      before_send: stripQuery,
    });
    posthog.identify(config.distinctId);
    loaded = posthog;
    return posthog;
  });
}

/** At logout: PostHog forgets the person (decision 082 C). */
export function stopAnalytics() {
  loaded?.reset();
  loaded = undefined;
}
