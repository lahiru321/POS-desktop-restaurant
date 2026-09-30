/**
 * Kitchen stations: free-text codes ("BAR", "GRILL") on a product or category
 * that decide which kitchen printer a dish's ticket goes to.
 *
 * A station is matched by string equality twice — when the server splits a
 * round into one ticket per station, and on the till, where
 * `kitchenStationTargets` maps it to a printer. So this must spell a station
 * exactly as the backend's `KitchenStations.normalize` does, or "bar" typed in a
 * form would never find the printer set up for "BAR".
 */

/** Where a dish goes when neither it nor its category names a station. */
export const DEFAULT_KITCHEN_STATION = 'KITCHEN';

/** Offered in the forms before any station exists. */
export const SUGGESTED_KITCHEN_STATIONS = ['KITCHEN', 'BAR'] as const;

export const KITCHEN_STATION_MAX_LENGTH = 20;

/** Letters, digits, space, underscore and hyphen — mirrors the server's @Pattern. */
export const KITCHEN_STATION_PATTERN = /^[A-Za-z0-9 _-]*$/;

/** Trimmed, inner spaces collapsed, upper-cased; blank → '' (inherit). */
export function normalizeKitchenStation(station: string | null | undefined): string {
  return (station ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Who to tell, in a sentence: "the kitchen" for KITCHEN, otherwise the station
 * itself ("BAR"). One round can make one ticket per station, and two identical
 * "tell the kitchen" toasts would leave the cashier guessing which went where.
 */
export function kitchenStationAudience(station: string | null | undefined): string {
  return !station || station === DEFAULT_KITCHEN_STATION ? 'the kitchen' : station;
}
