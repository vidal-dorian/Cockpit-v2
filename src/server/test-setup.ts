import { afterEach, vi } from "vitest";

// The server's files share their modules (isolate: false in vitest.config.ts): a test that fakes timers must not
// leave them fake for the next file.
afterEach(() => {
  vi.useRealTimers();
});
