import type { IngredientUnit } from '@/services/ingredientService';

/** Units in the order the form offers them, with how they read on screen. */
export const INGREDIENT_UNITS: { value: IngredientUnit; label: string; short: string }[] = [
  { value: 'KG', label: 'Kilograms (kg)', short: 'kg' },
  { value: 'G', label: 'Grams (g)', short: 'g' },
  { value: 'L', label: 'Litres (L)', short: 'L' },
  { value: 'ML', label: 'Millilitres (ml)', short: 'ml' },
  { value: 'PCS', label: 'Pieces (pcs)', short: 'pcs' },
];

/** `KG` → `kg`. Anything unknown (a product line's PCS included) passes through lower-cased. */
export function unitShort(unit: string | null | undefined): string {
  if (!unit) return '';
  return INGREDIENT_UNITS.find((u) => u.value === unit)?.short ?? unit.toLowerCase();
}

/**
 * A stock quantity as people read it: at most three decimals, no trailing zeros,
 * followed by the unit — `2.5 kg`, `12 pcs`, `0.125 L`.
 */
export function formatQty(quantity: number | null | undefined, unit?: string | null): string {
  const n = Number(quantity ?? 0);
  const text = (Math.round(n * 1000) / 1000).toLocaleString('en-US', {
    maximumFractionDigits: 3,
    useGrouping: false,
  });
  const u = unitShort(unit);
  return u ? `${text} ${u}` : text;
}

/** True when `value` has at most `places` decimals — what the backend accepts. */
export function hasAtMostDecimals(value: number, places: number): boolean {
  if (!Number.isFinite(value)) return false;
  const factor = 10 ** places;
  return Math.abs(Math.round(value * factor) - value * factor) < 1e-6;
}

/** A unit cost: always two decimals, up to four when a per-gram price needs them. */
export function formatUnitCost(cost: number | null | undefined): string {
  return Number(cost ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
