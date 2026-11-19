import { afterEach, vi } from "vitest";

// The server's files share their modules (isolate: false in vitest.config.ts): a test that fakes timers must not
// leave them fake for the next file.
afterEach(() => {
  vi.useRealTimers();
});

// Whatever the developer's shell exports, the suite never calls PostHog (the telemetry tests stub it themselves).
delete process.env.POSTHOG_KEY;
