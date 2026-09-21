import api from "./api";
import { ApiResponse } from "@/types/common";
import { SaleResponse } from "./salesService";
import { ToppingPriceMode } from "./toppingService";

/** DINE_IN needs a table; TAKEAWAY refuses one. */
export type OrderType = "DINE_IN" | "TAKEAWAY";

/**
 * OPEN    — accumulating rounds. At most one per table, enforced by a partial index.
 * SETTLED — paid; `saleId` points at the sale it became.
 * VOIDED  — abandoned without payment.
 */
export type OrderStatus = "OPEN" | "SETTLED" | "VOIDED";

// ──────────────────────────────────────────────
// Requests
// ──────────────────────────────────────────────

/**
 * One add-on on an ordered line.
 *
 * `unitPrice` is consulted only for a topping whose server-side `priceMode` is
 * PROMPT, and even then it is clamped to the topping's `maxPrice`. For a FIXED
 * topping the server bills the configured price and discards this value — the
 * exemption is keyed on the stored `price_mode`, never on anything the client
 * claims.
 */
export interface OrderItemToppingRequest {
  toppingId: string;
  /** Per parent unit. Defaults to 1 — "double cheese" is quantity 2. */
  quantity?: number;
  unitPrice?: number;
}

/**
 * A line to ring up.
 *
 * Exactly as on the retail terminal, a catalogue line (`productId` set) is
 * priced server-side from `products.base_price` and any `unitPrice` sent here is
 * ignored. A custom/open line (`productId` omitted, `itemName` given) accepts a
 * typed price. One of the two must be present or the request is rejected.
 */
export interface OrderItemRequest {
  productId?: string | null;
  /** Required for a custom/open line; ignored when `productId` is set. */
  itemName?: string | null;
  quantity: number;
  /** Honoured only for a custom/open line. */
  unitPrice?: number;
  discountAmount?: number;
  notes?: string;
  /** Starters 1, mains 2, dessert 3. Defaults to 1. */
  courseNo?: number;
  toppings?: OrderItemToppingRequest[];
}

export interface OpenOrderRequest {
  /** Defaults to DINE_IN. */
  orderType?: OrderType;
  /** Required for DINE_IN, rejected for TAKEAWAY. */
  tableId?: string | null;
  customerId?: string | null;
  /** Falls back to the user's primary branch, then the tenant default. */
  branchId?: string | null;
  covers?: number;
  /** The server looking after this table. Defaults to whoever opened it. */
  servedBy?: string | null;
  /** Optional opening round, so seating and the first order are one call. */
  items?: OrderItemRequest[];
}

export interface AddItemsRequest {
  items: OrderItemRequest[];
}

/** Edits that do not remove anything. Removing quantity is a void. */
export interface UpdateItemRequest {
  quantity?: number;
  notes?: string;
  courseNo?: number;
}

export interface VoidItemRequest {
  /** How much to void. Omitted = the whole remaining line. */
  quantity?: number;
  reason?: string;
}

export interface SettleRequest {
  paymentMethod: string;
  cashTendered?: number;
  pointsToRedeem?: number;
}

// ──────────────────────────────────────────────
// Responses
// ──────────────────────────────────────────────

export interface OrderItemToppingResponse {
  id: string;
  toppingId: string;
  toppingName: string;
  quantity: number;
  unitPrice: number;
  priceMode: ToppingPriceMode;
}

export interface OrderItemResponse {
  id: string;
  /** Null for a custom/open line. */
  productId?: string | null;
  itemName: string;
  quantity: number;
  firedQuantity: number;
  voidedQuantity: number;
  /** quantity − voidedQuantity. What the bill will charge for. */
  billableQuantity: number;
  unitPriceSnapshot: number;
  discountAmount: number;
  notes?: string | null;
  courseNo: number;
  sortOrder: number;
  toppings: OrderItemToppingResponse[];
}

export interface RestaurantOrder {
  id: string;
  orderNumber: number;
  /** "Order 14 · T1" — what staff say out loud. */
  label: string;
  /** ISO date, e.g. "2026-09-21". */
  businessDate: string;
  orderType: OrderType;
  status: OrderStatus;
  branchId?: string | null;
  /** Null for TAKEAWAY. */
  tableId?: string | null;
  tableName?: string | null;
  customerId?: string | null;
  covers: number;
  openedBy?: string | null;
  servedBy?: string | null;
  /** Set once SETTLED; the sale this order became. */
  saleId?: string | null;
  roundCount: number;
  /** ISO-8601 with a UTC offset, per the backend's Jackson customizer. */
  openedAt: string;
  settledAt?: string | null;
  /**
   * Ordered less voided, priced at the snapshots, no tax and no loyalty.
   * Indicative for the floor tiles — it is not the bill. The bill is whatever
   * `createSale` computes at settle.
   */
  runningTotal: number;
  items: OrderItemResponse[];
}

/**
 * A line whose menu price moved between ordering and paying.
 *
 * Settle re-reads the catalogue, which is correct and must not be weakened — so
 * the cashier is shown the difference rather than discovering it on the
 * customer's bill. A FIXED add-on that moved is reported the same way: then
 * `itemName` is the dish the add-on hangs off and `toppingName` is the add-on.
 * When `toppingName` is absent, the dish itself re-priced.
 */
export interface RepricedLine {
  itemName: string;
  /** Set only when a FIXED add-on moved, not the dish itself. */
  toppingName?: string | null;
  orderedPrice: number;
  billedPrice: number;
}

export interface SettleResponse {
  sale: SaleResponse;
  /** The order label, for the "Order 14 · T1 paid" confirmation. */
  label: string;
  /** Empty when nothing re-priced, which is the normal case. */
  repricedLines: RepricedLine[];
}

// ──────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────

/**
 * The open-tab lifecycle.
 *
 * Note there is deliberately no `fire` here: `POST /orders/{id}/fire` does not
 * exist on `RestaurantOrderController` yet. Kitchen firing arrives with the
 * `kitchen_tickets` migration (V64) — do not add a client method before the
 * endpoint it would call.
 */
export const restaurantOrderService = {
  /** Every OPEN order for the tenant. The floor view polls this. */
  getOpenOrders: () =>
    api
      .get<ApiResponse<RestaurantOrder[]>>("/restaurant/orders")
      .then((res) => res.data.data),

  getOrder: (id: string) =>
    api
      .get<ApiResponse<RestaurantOrder>>(`/restaurant/orders/${id}`)
      .then((res) => res.data.data),

  openOrder: (data: OpenOrderRequest) =>
    api
      .post<ApiResponse<RestaurantOrder>>("/restaurant/orders", data)
      .then((res) => res.data.data),

  addItems: (id: string, data: AddItemsRequest) =>
    api
      .post<ApiResponse<RestaurantOrder>>(`/restaurant/orders/${id}/items`, data)
      .then((res) => res.data.data),

  updateItem: (id: string, itemId: string, data: UpdateItemRequest) =>
    api
      .patch<ApiResponse<RestaurantOrder>>(
        `/restaurant/orders/${id}/items/${itemId}`,
        data
      )
      .then((res) => res.data.data),

  /** Omit `data` to void the whole remaining line. */
  voidItem: (id: string, itemId: string, data?: VoidItemRequest) =>
    api
      .post<ApiResponse<RestaurantOrder>>(
        `/restaurant/orders/${id}/items/${itemId}/void`,
        data ?? {}
      )
      .then((res) => res.data.data),

  /** Turns the tab into a sale on the *paying* cashier's drawer. */
  settle: (id: string, data: SettleRequest) =>
    api
      .post<ApiResponse<SettleResponse>>(`/restaurant/orders/${id}/settle`, data)
      .then((res) => res.data.data),

  /** ADMIN/MANAGER only — writes off the whole tab. */
  voidOrder: (id: string) =>
    api
      .post<ApiResponse<RestaurantOrder>>(`/restaurant/orders/${id}/void`)
      .then((res) => res.data.data),
};
