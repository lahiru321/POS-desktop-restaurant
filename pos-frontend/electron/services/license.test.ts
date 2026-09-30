import { describe, expect, it } from 'vitest';
import { isPastGrace, LICENSE_GRACE_DAYS } from './license';

const DAY = 24 * 60 * 60 * 1000;

describe('license grace period', () => {
  const now = Date.UTC(2026, 9, 10);
  const exp = (msFromNow: number) => Math.floor((now + msFromNow) / 1000);

  it('is 7 days, matching the backend', () => {
    expect(LICENSE_GRACE_DAYS).toBe(7);
  });

  it('keeps the till working until the grace period ends', () => {
    expect(isPastGrace(exp(30 * DAY), now)).toBe(false); // in date
    expect(isPastGrace(exp(-2 * DAY), now)).toBe(false); // expired, in grace
    expect(isPastGrace(exp(-8 * DAY), now)).toBe(true); // grace over
  });

  it('treats a license with no expiry as perpetual', () => {
    expect(isPastGrace(undefined, now)).toBe(false);
  });
});
