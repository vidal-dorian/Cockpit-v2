import { describe, expect, it } from "vitest";
import { nextOccurrence } from "./routines.ts";

// The hours that change with daylight saving time: the acceptance tests (routines.test.ts) cover the usual days.
const paris = (hour: number) => ({
  routineHour: hour,
  routineWeekday: null,
  routineTimeZone: "Europe/Paris",
});

describe("nextOccurrence", () => {
  it("given the hour that happens twice when the clocks go back, when the first one has passed, then the next run is the following day, not an hour later", () => {
    const next = nextOccurrence(new Date("2026-10-25T00:00:30Z"), paris(2));

    expect(next.toISOString()).toBe("2026-10-26T01:00:00.000Z");
  });

  it("given the hour that does not exist when the clocks go forward, when the next run is computed, then that day is skipped", () => {
    const next = nextOccurrence(new Date("2027-03-27T12:00:00Z"), paris(2));

    expect(next.toISOString()).toBe("2027-03-29T00:00:00.000Z");
  });
});
