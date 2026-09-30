/**
 * The floor map's arithmetic, kept apart from the UI so it can be tested alone.
 *
 * An area's map is a grid of cells; a table sits on one cell (`posX` = column,
 * `posY` = row, both from 0) or on none ("not placed"). The server holds the
 * same rules — V69's CHECK and deferred unique constraint, and
 * `TableService.saveLayout` — so these are for the editor's feel, never the
 * last word.
 */

/** Columns and rows a map can have. Mirrors `RestaurantTableEntity.MAP_SIZE`. */
export const FLOOR_MAP_SIZE = 16;

/** The editor never shows fewer cells than this, so an empty map has room. */
const EDITOR_MIN_COLS = 8;
const EDITOR_MIN_ROWS = 6;

export interface Cell {
  x: number;
  y: number;
}

/** tableId → its cell, or null when it is off the map. */
export type Positions = Record<string, Cell | null>;

interface Positioned {
  id: string;
  posX?: number | null;
  posY?: number | null;
}

/** Only a table with both coordinates is on the map. */
export function cellOf(table: Positioned): Cell | null {
  return table.posX != null && table.posY != null ? { x: table.posX, y: table.posY } : null;
}

export function positionsOf(tables: Positioned[]): Positions {
  return Object.fromEntries(tables.map((t) => [t.id, cellOf(t)]));
}

/** Which table (if any) is on a cell. */
export function tableAt(positions: Positions, cell: Cell): string | null {
  for (const [id, c] of Object.entries(positions)) {
    if (c && c.x === cell.x && c.y === cell.y) return id;
  }
  return null;
}

/**
 * The till's map: exactly as big as its placed tables need, so a room laid out
 * in the top-left corner is not drawn with empty space to the right.
 */
export function mapBounds(cells: Cell[]): { cols: number; rows: number } {
  return {
    cols: Math.max(0, ...cells.map((c) => c.x)) + 1,
    rows: Math.max(0, ...cells.map((c) => c.y)) + 1,
  };
}

/**
 * The editor's grid: always one spare column and row past the furthest table
 * (so the room can grow by dragging to the edge), never under a comfortable
 * minimum, never over the cap.
 */
export function editorBounds(positions: Positions): { cols: number; rows: number } {
  const cells = Object.values(positions).filter((c): c is Cell => c !== null);
  const { cols, rows } = cells.length > 0 ? mapBounds(cells) : { cols: 0, rows: 0 };
  return {
    cols: Math.min(FLOOR_MAP_SIZE, Math.max(EDITOR_MIN_COLS, cols + 1)),
    rows: Math.min(FLOOR_MAP_SIZE, Math.max(EDITOR_MIN_ROWS, rows + 1)),
  };
}

export function inBounds(cell: Cell): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < FLOOR_MAP_SIZE && cell.y < FLOOR_MAP_SIZE;
}

/**
 * Puts a table on a cell — or takes it off the map with `null`.
 *
 * Dropping onto another table swaps the two: the other table takes the moved
 * one's old spot. If the moved table came from off the map, the one it
 * displaces goes off the map in its place, which is still a swap and never
 * loses a table. Out-of-bounds cells are ignored.
 */
export function moveTable(positions: Positions, tableId: string, to: Cell | null): Positions {
  if (to && !inBounds(to)) return positions;
  const from = positions[tableId] ?? null;
  const next: Positions = { ...positions, [tableId]: to };
  if (to) {
    const occupant = tableAt(positions, to);
    if (occupant && occupant !== tableId) next[occupant] = from;
  }
  return next;
}

/**
 * Places every table that is off the map into the first free cells, reading
 * across then down within `cols` columns, in the order given (floor order).
 * Tables already placed stay put. Stops quietly if the map is full.
 */
export function autoPlace(positions: Positions, orderedIds: string[], cols: number): Positions {
  const width = Math.min(FLOOR_MAP_SIZE, Math.max(1, cols));
  const next: Positions = { ...positions };
  let cursor = 0;
  for (const id of orderedIds) {
    if (next[id]) continue;
    while (cursor < width * FLOOR_MAP_SIZE) {
      const cell = { x: cursor % width, y: Math.floor(cursor / width) };
      cursor++;
      if (!tableAt(next, cell)) {
        next[id] = cell;
        break;
      }
    }
  }
  return next;
}

/** What changed between the saved layout and the draft, as the server wants it. */
export function layoutChanges(
  saved: Positions,
  draft: Positions,
): { tableId: string; posX: number | null; posY: number | null }[] {
  return Object.entries(draft)
    .filter(([id, cell]) => {
      const before = saved[id] ?? null;
      return (before?.x ?? null) !== (cell?.x ?? null) || (before?.y ?? null) !== (cell?.y ?? null);
    })
    .map(([tableId, cell]) => ({ tableId, posX: cell?.x ?? null, posY: cell?.y ?? null }));
}
