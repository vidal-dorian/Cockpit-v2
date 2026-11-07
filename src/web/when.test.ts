import { expect, it } from "vitest";
import { ago, elapsed } from "./when.ts";

const now = Date.parse("2026-11-07T12:00:00Z");
const before = (minutes: number) =>
  new Date(now - minutes * 60_000).toISOString();

it.each([
  [0, "à l'instant"],
  [20, "il y a 20 min"],
  [180, "il y a 3 h"],
  [24 * 60, "hier"],
  [4 * 24 * 60, "il y a 4 j"],
])("given %i minutes, then it says %s", (minutes, text) => {
  expect(ago(before(minutes), now)).toBe(text);
});

it.each([
  [0, "0 min"],
  [20, "20 min"],
  [180, "3 h"],
  [4 * 24 * 60, "4 j"],
])("given %i minutes, then elapsed says %s", (minutes, text) => {
  expect(elapsed(before(minutes), now)).toBe(text);
});
