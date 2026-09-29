import api from "./api";
import { ApiResponse } from "@/types/common";
import type { OrderType } from "./restaurantOrderService";

/**
 * ROUND = new work for the kitchen; VOID = stop cooking these;
 * MOVE = no lines, the food already sent goes to a different table.
 */
export type KitchenTicketType = "ROUND" | "VOID" | "MOVE";

/**
 * PENDING — recorded, not yet confirmed printed. Counts as unresolved once it
 *           has sat past the server's grace period.
 * PRINTED — the printer took it, or a person took responsibility for it.
 * FAILED  — the printer did not. Unresolved until retried or handled.
 */
export type KitchenTicketStatus = "PENDING" | "PRINTED" | "FAILED";

export interface KitchenTicketItem {
  itemName: string;
  /** The delta for this sheet, not the line's running total. */
  quantity: number;
  /** Add-ons, one per entry, as printed ("Extra cheese", "2 x Egg"). */
  modifiers: string[];
  notes?: string | null;
  courseNo: number;
}

/**
 * One sheet for the kitchen. There is no price anywhere on this shape — a
 * price on a kitchen ticket is a bug, and the builder never has one to print.
 */
export interface KitchenTicket {
  id: string;
  orderId: string;
  orderNumber: number;
  /** "#0042-R2" / "#0042-R3-VOID". */
  label: string;
  ticketType: KitchenTicketType;
  roundNo: number;
  station: string;
  status: KitchenTicketStatus;
  orderType: OrderType;
  tableName?: string | null;
  covers: number;
  serverName?: string | null;
  printAttempts: number;
  lastError?: string | null;
  /** MOVE tickets only: "MOVED FROM T4". */
  notice?: string | null;
  /** ISO-8601 — the time printed on the sheet. */
  firedAt: string;
  printedAt?: string | null;
  items: KitchenTicketItem[];
}

/**
 * PRINTED — the printer accepted the job.
 * FAILED  — it did not; `note` carries the printer error.
 * HANDLED — it did not, and a person told the kitchen themselves. Resolves the
 *           ticket; `note` is required and kept on the record.
 */
export type KitchenAckOutcome = "PRINTED" | "FAILED" | "HANDLED";

export interface KitchenAckRequest {
  outcome: KitchenAckOutcome;
  note?: string;
}

export const kitchenTicketService = {
  /** Failed, or stuck pending past the grace period. The till's badge polls this. */
  getUnresolved: () =>
    api
      .get<ApiResponse<KitchenTicket[]>>("/restaurant/kitchen-tickets")
      .then((res) => res.data.data),

  getForOrder: (orderId: string) =>
    api
      .get<ApiResponse<KitchenTicket[]>>("/restaurant/kitchen-tickets", { params: { orderId } })
      .then((res) => res.data.data),

  acknowledge: (id: string, data: KitchenAckRequest) =>
    api
      .post<ApiResponse<KitchenTicket>>(`/restaurant/kitchen-tickets/${id}/ack`, data)
      .then((res) => res.data.data),

  /** The stored sheet, back to PENDING, ready to print again. Fires nothing new. */
  reprint: (id: string) =>
    api
      .post<ApiResponse<KitchenTicket>>(`/restaurant/kitchen-tickets/${id}/reprint`)
      .then((res) => res.data.data),
};
