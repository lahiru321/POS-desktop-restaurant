/**
 * When to restart a server process that died, as a pure function so it can be
 * tested without Electron.
 *
 * Up to {@link MAX_RESTARTS} restarts within {@link WINDOW_MS}, waiting 2 s, 4 s,
 * then 8 s. A process that dies more often than that is crash-looping (a broken
 * database, a full disk); restarting it forever would hide the problem behind a
 * spinner, so the launcher stops and says so.
 */

export const MAX_RESTARTS = 3;
export const WINDOW_MS = 10 * 60 * 1000;
const BASE_DELAY_MS = 2000;

export type RestartDecision =
  | { restart: true; attempt: number; max: number; delayMs: number; history: number[] }
  | { restart: false; history: number[] };

/** @param history when earlier restarts happened (ms), @param now the time of this death */
export function decideRestart(history: number[], now: number): RestartDecision {
  const recent = history.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_RESTARTS) {
    return { restart: false, history: recent };
  }
  const attempt = recent.length + 1;
  return {
    restart: true,
    attempt,
    max: MAX_RESTARTS,
    delayMs: BASE_DELAY_MS * 2 ** (attempt - 1),
    history: [...recent, now],
  };
}
