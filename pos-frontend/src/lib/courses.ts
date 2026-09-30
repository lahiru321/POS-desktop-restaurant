/**
 * Course-by-course firing, as the till sees it (V70).
 *
 * A tab has a released course. Send fires every unsent line at or below it;
 * a line in a later course is *held* until "Fire course N" raises the release.
 * The server decides — `OrderItemResponse.held` is its verdict — and these
 * helpers only count and label what it said, so the till can never disagree.
 */
import type { RestaurantOrder } from '@/services/restaurantOrderService';

/** The courses the till offers. The server takes up to 9; three is a menu. */
export const COURSE_CHOICES = [1, 2, 3] as const;

export type KitchenState = 'sent' | 'new' | 'held';

export interface CourseSummary {
  /** Lines with something Send would fire now. */
  sendCount: number;
  /** The lowest course with held lines, or null when nothing is waiting. */
  nextHeldCourse: number | null;
  /**
   * Lines held in that course — the button's count. Firing it also takes any
   * ready line with it, but those are Send's count; counting them twice would
   * read as more mains than the table ordered.
   */
  nextHeldCount: number;
}

/** Where a line stands with the kitchen: all sent, some to send now, or waiting for its course. */
export function kitchenStateOf(item: { pendingQuantity: number; held?: boolean }): KitchenState {
  if (item.pendingQuantity <= 0) return 'sent';
  return item.held ? 'held' : 'new';
}

export function courseSummary(order: RestaurantOrder | undefined): CourseSummary {
  if (!order) return { sendCount: 0, nextHeldCourse: null, nextHeldCount: 0 };
  let sendCount = 0;
  let nextHeldCourse: number | null = null;
  for (const item of order.items) {
    const state = kitchenStateOf(item);
    if (state === 'new') sendCount++;
    if (state === 'held' && (nextHeldCourse === null || item.courseNo < nextHeldCourse)) {
      nextHeldCourse = item.courseNo;
    }
  }
  const nextHeldCount = order.items.filter(
    (i) => kitchenStateOf(i) === 'held' && i.courseNo === nextHeldCourse,
  ).length;
  return { sendCount, nextHeldCourse, nextHeldCount };
}

/** 1 → 2 → 3 → 1: the course chip on a line cycles through the menu's courses. */
export function nextCourse(courseNo: number): number {
  const at = COURSE_CHOICES.indexOf(courseNo as (typeof COURSE_CHOICES)[number]);
  return at === -1 || at === COURSE_CHOICES.length - 1 ? COURSE_CHOICES[0] : COURSE_CHOICES[at + 1];
}
