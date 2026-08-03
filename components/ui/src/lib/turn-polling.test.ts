import { describe, expect, test } from "bun:test";

import { turnPollDelayMs } from "./turn-polling";

describe("turn polling cadence", () => {
  test("is responsive at first and backs off for long turns", () => {
    expect(turnPollDelayMs(0, false)).toBe(750);
    expect(turnPollDelayMs(14_999, false)).toBe(750);
    expect(turnPollDelayMs(15_000, false)).toBe(1_500);
    expect(turnPollDelayMs(60_000, false)).toBe(3_000);
  });

  test("uses a low-wakeup cadence while the shell is hidden", () => {
    expect(turnPollDelayMs(0, true)).toBe(5_000);
    expect(turnPollDelayMs(120_000, true)).toBe(5_000);
  });
});
