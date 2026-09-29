import { expect, test } from "vitest";

// Throwaway: proves a red `test` blocks the merge (TRACK-2728). Never merged.
test("ruleset probe fails on purpose", () => {
  expect(1).toBe(2);
});
