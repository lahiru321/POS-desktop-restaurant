import { describe, expect, it } from 'vitest';
import { decideRestart, MAX_RESTARTS, WINDOW_MS } from './supervisor';

describe('decideRestart', () => {
  it('restarts with a growing wait: 2 s, 4 s, 8 s', () => {
    let history: number[] = [];
    const delays: number[] = [];
    for (let i = 0; i < MAX_RESTARTS; i++) {
      const d = decideRestart(history, 1000 + i);
      expect(d.restart).toBe(true);
      if (d.restart) {
        delays.push(d.delayMs);
        expect(d.attempt).toBe(i + 1);
      }
      history = d.history;
    }
    expect(delays).toEqual([2000, 4000, 8000]);
  });

  it('gives up on a crash loop instead of spinning forever', () => {
    const now = 100_000;
    const d = decideRestart([now - 3000, now - 2000, now - 1000], now);
    expect(d.restart).toBe(false);
  });

  it('forgets restarts older than the window, so a till that crashes once a day always recovers', () => {
    const now = WINDOW_MS * 10;
    const old = [now - WINDOW_MS - 3, now - WINDOW_MS - 2, now - WINDOW_MS - 1];
    const d = decideRestart(old, now);
    expect(d).toMatchObject({ restart: true, attempt: 1, delayMs: 2000 });
    expect(d.history).toEqual([now]);
  });
});
