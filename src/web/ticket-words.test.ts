import { afterEach, describe, expect, it, vi } from "vitest";
import { age, normalizeTag } from "./tickets.ts";

afterEach(() => vi.useRealTimers());

describe("age", () => {
  it.each([
    [0, "à l'instant"],
    [10, "10 min"],
    [3 * 60, "3 h"],
    [2 * 1440, "2 j"],
    [14 * 1440, "2 sem."],
    [90 * 1440, "3 mois"],
  ])("given %i minutes, then it reads %s", (minutes, words) => {
    vi.useFakeTimers({ now: new Date("2026-11-08T12:00:00Z") });
    const created = new Date(Date.now() - minutes * 60_000).toISOString();
    expect(age(created)).toBe(words);
  });
});

describe("normalizeTag", () => {
  it("trims, reduces inner spaces and lowercases", () => {
    expect(normalizeTag("  Export   Mensuel ")).toBe("export mensuel");
  });
});
