// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

// Decision 083 C: telemetry is never worth a broken page, so a posthog-js that fails to start silences it for good.
const ph = vi.hoisted(() => ({
  init: vi.fn(() => {
    throw new Error("boom");
  }),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("posthog-js", () => ({ default: ph }));

it("given posthog-js throws at init, then the queued calls are dropped and every later call is a no-op", async () => {
  const telemetry = await import("./telemetry.ts");
  const started = telemetry.init("phc_test");
  telemetry.identify("7");
  telemetry.track("$pageview", { screen: "/" });
  await expect(started).rejects.toThrow("boom");

  telemetry.track("$pageview", { screen: "/claude" });
  telemetry.identify("8");
  await telemetry.init("phc_test");

  expect(ph.init).toHaveBeenCalledTimes(1);
  expect(ph.capture).not.toHaveBeenCalled();
  expect(ph.identify).not.toHaveBeenCalled();
});
