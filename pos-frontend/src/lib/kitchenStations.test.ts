import { describe, expect, it } from 'vitest';
import { KITCHEN_STATION_PATTERN, normalizeKitchenStation } from './kitchenStations';

// Must agree with the backend's KitchenStations.normalize, or a station typed in
// a form never matches the till's station → printer map.
describe('normalizeKitchenStation', () => {
  it('trims, collapses inner spaces and upper-cases', () => {
    expect(normalizeKitchenStation('  cold   bar ')).toBe('COLD BAR');
  });

  it('turns blank, null and undefined into "" — inherit', () => {
    expect(normalizeKitchenStation('   ')).toBe('');
    expect(normalizeKitchenStation(null)).toBe('');
    expect(normalizeKitchenStation(undefined)).toBe('');
  });

  it('accepts what fits a ticket header and rejects the rest', () => {
    expect(KITCHEN_STATION_PATTERN.test('HOT_LINE-2 A')).toBe(true);
    expect(KITCHEN_STATION_PATTERN.test('BAR/2')).toBe(false);
  });
});
