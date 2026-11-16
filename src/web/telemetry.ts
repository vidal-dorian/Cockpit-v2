import type { PostHog } from "posthog-js";

// Decision 083 C: the only module that talks to posthog-js. Everything is a no-op until `init` got a key.
// posthog-js is loaded only then, so a Cockpit without a key does not ship it to the page.
let posthog: PostHog | undefined;
let started = false;
// Calls made while posthog-js is still loading, replayed in order once it is there.
let waiting: ((ph: PostHog) => void)[] = [];

const run = (call: (ph: PostHog) => void) => {
  if (posthog) call(posthog);
  else if (started) waiting.push(call);
};

/** Properties that would carry the real address (decision 083 D). */
const isAddress = (name: string) =>
  /url|pathname|referr|host/.test(name) || name.startsWith("$initial_");

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

/** Resolves once posthog-js runs (at once without a key); the page waits for it before showing screens. */
export async function init(key: string | null) {
  if (!key || started) return;
  started = true;
  // Under nodenext the default import is typed as the module namespace; at run time it is the instance.
  const loaded = (await import("posthog-js")).default as unknown as PostHog;
  loaded.init(key, {
    api_host: "https://eu.i.posthog.com",
    persistence: "memory",
    person_profiles: "identified_only",
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: false,
    capture_exceptions: true,
    reuseAnonymousId: true,
    // What would leave without going through before_send, or that the PostHog project could switch on.
    advanced_disable_flags: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    capture_performance: false,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    before_send: beforeSend,
  });
  posthog = loaded;
  for (const call of waiting) call(loaded);
  waiting = [];
}

export function track(event: string, props: Record<string, unknown>) {
  run((ph) => ph.capture(event, props));
}

export function identify(id: string) {
  run((ph) => ph.identify(id));
}

/** The previous identity must not follow the next login (decision 083 C). */
export function reset() {
  run((ph) => ph.reset());
}

export function captureException(error: unknown) {
  run((ph) => ph.captureException(error));
}
