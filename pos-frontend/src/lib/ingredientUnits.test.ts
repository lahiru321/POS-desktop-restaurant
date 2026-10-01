import { describe, expect, it } from 'vitest';
import { formatQty, formatUnitCost, hasAtMostDecimals, unitShort } from './ingredientUnits';

describe('formatQty', () => {
  it('drops trailing zeros and adds the unit', () => {
    expect(formatQty(2.5, 'KG')).toBe('2.5 kg');
    expect(formatQty(12, 'PCS')).toBe('12 pcs');
    expect(formatQty(0.125, 'L')).toBe('0.125 L');
    expect(formatQty(1500, 'G')).toBe('1500 g');
  });

  it('rounds float noise to three places', () => {
    expect(formatQty(0.1 + 0.2, 'ML')).toBe('0.3 ml');
  });

  it('copes with nothing', () => {
    expect(formatQty(undefined)).toBe('0');
    expect(formatQty(3, null)).toBe('3');
  });
});

describe('unitShort', () => {
  it('maps known units and lower-cases the rest', () => {
    expect(unitShort('ML')).toBe('ml');
    expect(unitShort('BOX')).toBe('box');
    expect(unitShort(undefined)).toBe('');
  });
});

describe('hasAtMostDecimals', () => {
  it('matches what the backend accepts', () => {
    expect(hasAtMostDecimals(2.5, 3)).toBe(true);
    expect(hasAtMostDecimals(1.125, 3)).toBe(true);
    expect(hasAtMostDecimals(1.0005, 3)).toBe(false);
    expect(hasAtMostDecimals(24, 0)).toBe(true);
    expect(hasAtMostDecimals(1.5, 0)).toBe(false);
    expect(hasAtMostDecimals(NaN, 3)).toBe(false);
  });
});

describe('formatUnitCost', () => {
  it('shows two places, more only when needed', () => {
    expect(formatUnitCost(450)).toBe('450.00');
    expect(formatUnitCost(0.0125)).toBe('0.0125');
    expect(formatUnitCost(12.3456)).toBe('12.3456');
  });
});
