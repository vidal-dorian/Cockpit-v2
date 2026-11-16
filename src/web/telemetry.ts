import type { PostHog } from "posthog-js";
import posthogModule from "posthog-js";

// Under nodenext the default import is typed as the module namespace; at run time it is the instance.
const posthog = posthogModule as unknown as PostHog;

// Decision 083 C: the only module that imports posthog-js. Everything is a no-op until `init` got a key.
let started = false;

/** Properties that would carry the real address (decision 083 D). */
const isAddress = (name: string) =>
  ["$current_url", "$pathname", "$referrer", "$referring_domain"].includes(
    name,
  ) || name.startsWith("$initial_");

function strip(bag: Record<string, unknown> | undefined) {
  if (!bag) return bag;
  return Object.fromEntries(
    Object.entries(bag).filter(([name]) => !isAddress(name)),
  );
}

// biome-ignore lint/suspicious/noExplicitAny: posthog-js types its CaptureResult more narrowly than this strip needs
function beforeSend(event: any) {
  event.properties = strip(event.properties);
  if (event.$set) event.$set = strip(event.$set);
  if (event.$set_once) event.$set_once = strip(event.$set_once);
  return event;
}

export function init(key: string | null) {
  if (!key || started) return;
  started = true;
  posthog.init(key, {
    api_host: "https://eu.i.posthog.com",
    persistence: "memory",
    person_profiles: "identified_only",
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: false,
    capture_exceptions: true,
    before_send: beforeSend,
  });
}

export function track(event: string, props: Record<string, unknown>) {
  if (started) posthog.capture(event, props);
}

export function identify(id: string) {
  if (started) posthog.identify(id);
}

export function captureException(error: unknown) {
  if (started) posthog.captureException(error);
}
