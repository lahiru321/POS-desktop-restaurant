import api from "./api";
import { ApiResponse } from "@/types/common";

/**
 * A table's occupancy, and the one field on a table no client may set.
 *
 * AVAILABLE — no open tab, free to seat.
 * OCCUPIED  — an open order is running on it.
 *
 * The server owns this: a table becomes OCCUPIED because an order was opened on
 * it and AVAILABLE because that order was settled or voided. There is no request
 * shape that carries it, by design — letting a client post it would let the floor
 * disagree with the orders it is meant to reflect.
 */
export type TableStatus = "AVAILABLE" | "OCCUPIED";

export interface RestaurantTable {
  id: string;
  areaId: string;
  /** Denormalised for the floor tiles, so a tile needs no second lookup. */
  areaName: string;
  name: string;
  seats: number;
  /** Server-owned; see {@link TableStatus}. */
  status: TableStatus;
  sortOrder: number;
  isActive: boolean;
  /**
   * Where the table stands on its area's floor map: column and row from 0.
   * Both null until someone places it; the floor then shows it as a plain tile.
   * Set only through {@link tableService.saveLayout} — the table form never
   * sends these, and moving a table to another area clears them.
   */
  posX?: number | null;
  posY?: number | null;
}

/** One table's spot in a layout save. Both null = take it off the map. */
export interface TablePlacement {
  tableId: string;
  posX: number | null;
  posY: number | null;
}

export interface RestaurantArea {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** The area's tables, in floor order. Empty for a freshly created area. */
  tables: RestaurantTable[];
}

export interface AreaRequest {
  name: string;
  sortOrder?: number;
  isActive: boolean;
}

export interface TableRequest {
  areaId: string;
  name: string;
  /** 1-99. The backend rejects 0 and anything above 99. */
  seats?: number;
  sortOrder?: number;
  isActive: boolean;
}

export const tableService = {
  // --- Areas ---
  getAreas: () =>
    api
      .get<ApiResponse<RestaurantArea[]>>("/restaurant/areas")
      .then((res) => res.data.data),

  createArea: (data: AreaRequest) =>
    api
      .post<ApiResponse<RestaurantArea>>("/restaurant/areas", data)
      .then((res) => res.data.data),

  updateArea: (id: string, data: AreaRequest) =>
    api
      .put<ApiResponse<RestaurantArea>>(`/restaurant/areas/${id}`, data)
      .then((res) => res.data.data),

  /**
   * Saves an area's floor map. Only the tables listed move; the server checks
   * the finished layout as a whole, so a swap is a single call.
   */
  saveLayout: (areaId: string, tables: TablePlacement[]) =>
    api
      .put<ApiResponse<RestaurantArea>>(`/restaurant/areas/${areaId}/layout`, { tables })
      .then((res) => res.data.data),

  deleteArea: (id: string) =>
    api
      .delete<ApiResponse<void>>(`/restaurant/areas/${id}`)
      .then((res) => res.data.data),

  // --- Tables ---

  /** Every table, or one area's, in floor order. */
  getTables: (areaId?: string) =>
    api
      .get<ApiResponse<RestaurantTable[]>>("/restaurant/tables", {
        params: areaId ? { areaId } : undefined,
      })
      .then((res) => res.data.data),

  createTable: (data: TableRequest) =>
    api
      .post<ApiResponse<RestaurantTable>>("/restaurant/tables", data)
      .then((res) => res.data.data),

  updateTable: (id: string, data: TableRequest) =>
    api
      .put<ApiResponse<RestaurantTable>>(`/restaurant/tables/${id}`, data)
      .then((res) => res.data.data),

  deleteTable: (id: string) =>
    api
      .delete<ApiResponse<void>>(`/restaurant/tables/${id}`)
      .then((res) => res.data.data),
};
