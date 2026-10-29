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

  it.each([
    // Sunday 2 h, and the next Sunday has no 2 h: the following week (022 D).
    [
      "Europe/Paris",
      "2026-03-22T01:00:30Z", // just after Sunday 22 March 2 h CET
      "2026-04-05T00:00:00.000Z", // Sunday 29 March has no 2 h; 5 April 2 h is CEST
    ],
    [
      "America/New_York",
      "2026-03-01T07:00:30Z", // just after Sunday 1 March 2 h EST
      "2026-03-15T06:00:00.000Z", // Sunday 8 March has no 2 h; 15 March 2 h is EDT
    ],
  ])(
    "given a weekly Sunday 2 h in %s, when the next Sunday has no 2 h because the clocks go forward, then the next run is the Sunday after, not an error",
    (routineTimeZone, after, expected) => {
      const next = nextOccurrence(new Date(after), {
        routineHour: 2,
        routineWeekday: 7,
        routineTimeZone,
      });

      expect(next.toISOString()).toBe(expected);
    },
  );
});
