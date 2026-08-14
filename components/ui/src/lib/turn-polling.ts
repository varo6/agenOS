const FAST_TURN_WINDOW_MS = 15_000;
const LONG_TURN_THRESHOLD_MS = 60_000;

/**
 * Keep the beginning of a turn responsive, then spend fewer wakeups on model
 * calls and tools that have already been running for a while. A hidden shell
 * has no useful intermediate animation, so it can wait longer.
 */
export function turnPollDelayMs(elapsedMs: number, hidden: boolean): number {
  if (hidden) {
    return 5_000;
  }
  if (elapsedMs < FAST_TURN_WINDOW_MS) {
    return 750;
  }
  if (elapsedMs < LONG_TURN_THRESHOLD_MS) {
    return 1_500;
  }
  return 3_000;
}
