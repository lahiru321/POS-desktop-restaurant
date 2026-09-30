import { describe, expect, it } from 'vitest';
import type { RestaurantOrder } from '@/services/restaurantOrderService';
import { courseSummary, kitchenStateOf, nextCourse } from './courses';

type Line = { courseNo: number; pendingQuantity: number; held: boolean };

function tab(lines: Line[]): RestaurantOrder {
  return { items: lines } as unknown as RestaurantOrder;
}

describe('courses', () => {
  it('reads a line as sent, new, or held', () => {
    expect(kitchenStateOf({ pendingQuantity: 0, held: false })).toBe('sent');
    expect(kitchenStateOf({ pendingQuantity: 2, held: false })).toBe('new');
    expect(kitchenStateOf({ pendingQuantity: 1, held: true })).toBe('held');
  });

  it('counts what Send fires and what the next course holds', () => {
    const summary = courseSummary(
      tab([
        { courseNo: 1, pendingQuantity: 0, held: false }, // sent soup
        { courseNo: 1, pendingQuantity: 1, held: false }, // a late starter
        { courseNo: 2, pendingQuantity: 2, held: true },
        { courseNo: 2, pendingQuantity: 1, held: true },
        { courseNo: 3, pendingQuantity: 2, held: true },
      ]),
    );
    expect(summary).toEqual({ sendCount: 1, nextHeldCourse: 2, nextHeldCount: 2 });
  });

  it('has nothing to fire on an empty or fully sent tab', () => {
    expect(courseSummary(undefined)).toEqual({ sendCount: 0, nextHeldCourse: null, nextHeldCount: 0 });
    expect(courseSummary(tab([{ courseNo: 2, pendingQuantity: 0, held: false }]))).toEqual({
      sendCount: 0,
      nextHeldCourse: null,
      nextHeldCount: 0,
    });
  });

  it('cycles a line through the courses', () => {
    expect([1, 2, 3].map(nextCourse)).toEqual([2, 3, 1]);
    expect(nextCourse(7)).toBe(1);
  });
});
