/**
 * Where a tab's lines stand with the kitchen, as the till shows it.
 *
 * There are no courses: Send fires every unsent line (`pendingQuantity > 0`),
 * so a line is either already with the kitchen or waiting for the next Send.
 */
import type { RestaurantOrder } from '@/services/restaurantOrderService';

export type KitchenState = 'sent' | 'new';

/** All of it sent, or some of it still to go on the next Send. */
export function kitchenStateOf(item: { pendingQuantity: number }): KitchenState {
  return item.pendingQuantity > 0 ? 'new' : 'sent';
}

/** Lines with something Send would fire now — the Send button's count. */
export function unsentLineCount(order: RestaurantOrder | undefined): number {
  return order ? order.items.filter((i) => kitchenStateOf(i) === 'new').length : 0;
}
