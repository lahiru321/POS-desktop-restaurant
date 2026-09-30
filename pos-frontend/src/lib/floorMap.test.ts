import { describe, expect, it } from 'vitest';
import {
  FLOOR_MAP_SIZE,
  autoPlace,
  editorBounds,
  layoutChanges,
  mapBounds,
  moveTable,
  positionsOf,
  type Positions,
} from './floorMap';

const layout = (p: Positions) => p;

describe('floorMap', () => {
  it('reads a table as placed only when it has both coordinates', () => {
    expect(
      positionsOf([
        { id: 'a', posX: 1, posY: 2 },
        { id: 'b', posX: null, posY: null },
        { id: 'c' },
      ]),
    ).toEqual({ a: { x: 1, y: 2 }, b: null, c: null });
  });

  it('sizes the till map to its furthest table', () => {
    expect(mapBounds([{ x: 0, y: 0 }, { x: 3, y: 1 }])).toEqual({ cols: 4, rows: 2 });
  });

  it('gives the editor a spare column and row, within a minimum and the cap', () => {
    expect(editorBounds({})).toEqual({ cols: 8, rows: 6 });
    expect(editorBounds({ a: { x: 9, y: 7 } })).toEqual({ cols: 11, rows: 9 });
    expect(editorBounds({ a: { x: 15, y: 15 } })).toEqual({ cols: FLOOR_MAP_SIZE, rows: FLOOR_MAP_SIZE });
  });

  it('moves a table to a free cell', () => {
    const next = moveTable(layout({ a: { x: 0, y: 0 }, b: null }), 'a', { x: 2, y: 1 });
    expect(next.a).toEqual({ x: 2, y: 1 });
  });

  it('swaps when dropped on another table', () => {
    const next = moveTable(layout({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }), 'a', { x: 1, y: 0 });
    expect(next).toEqual({ a: { x: 1, y: 0 }, b: { x: 0, y: 0 } });
  });

  it('sends the displaced table off the map when the moved one came from off it', () => {
    const next = moveTable(layout({ a: null, b: { x: 1, y: 0 } }), 'a', { x: 1, y: 0 });
    expect(next).toEqual({ a: { x: 1, y: 0 }, b: null });
  });

  it('takes a table off the map with null, and ignores cells outside the map', () => {
    const start = layout({ a: { x: 0, y: 0 } });
    expect(moveTable(start, 'a', null)).toEqual({ a: null });
    expect(moveTable(start, 'a', { x: FLOOR_MAP_SIZE, y: 0 })).toBe(start);
  });

  it('auto-places only unplaced tables, in order, around the ones already down', () => {
    const next = autoPlace(layout({ a: { x: 0, y: 0 }, b: null, c: null }), ['a', 'b', 'c'], 2);
    expect(next).toEqual({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, c: { x: 0, y: 1 } });
  });

  it('reports only the tables whose spot changed', () => {
    const saved = layout({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, c: null });
    const draft = layout({ a: { x: 1, y: 0 }, b: { x: 0, y: 0 }, c: null });
    expect(layoutChanges(saved, draft)).toEqual([
      { tableId: 'a', posX: 1, posY: 0 },
      { tableId: 'b', posX: 0, posY: 0 },
    ]);
    expect(layoutChanges(saved, { ...saved })).toEqual([]);
  });
});
