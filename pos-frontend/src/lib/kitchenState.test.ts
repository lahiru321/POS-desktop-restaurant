import { describe, expect, it } from 'vitest';
import type { RestaurantOrder } from '@/services/restaurantOrderService';
import { kitchenStateOf, unsentLineCount } from './kitchenState';

describe('kitchenState', () => {
  it('reads a line as sent or new', () => {
    expect(kitchenStateOf({ pendingQuantity: 0 })).toBe('sent');
    expect(kitchenStateOf({ pendingQuantity: 2 })).toBe('new');
  });

  it('counts every line Send would fire', () => {
    const order = {
      items: [{ pendingQuantity: 0 }, { pendingQuantity: 1 }, { pendingQuantity: 2 }],
    } as unknown as RestaurantOrder;
    expect(unsentLineCount(order)).toBe(2);
    expect(unsentLineCount(undefined)).toBe(0);
  });
});
