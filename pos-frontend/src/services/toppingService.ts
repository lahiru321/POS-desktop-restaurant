import api from "./api";
import { ApiResponse } from "@/types/common";

/**
 * How a topping's price is decided.
 *
 * FIXED  — the server always bills `defaultPrice`; anything the client sends is
 *          discarded, exactly as it is for a catalogue product.
 * PROMPT — the cashier types the price at order time. The server still clamps it
 *          to `maxPrice`, so this is a bounded exemption, not an open door.
 */
export type ToppingPriceMode = "FIXED" | "PROMPT";

/** SINGLE renders radios, MULTI renders checkboxes. */
export type ToppingSelectionMode = "SINGLE" | "MULTI";

export interface Topping {
  id: string;
  groupId: string;
  name: string;
  priceMode: ToppingPriceMode;
  defaultPrice: number;
  /** PROMPT only; null means uncapped. */
  maxPrice?: number | null;
  sortOrder?: number;
  isActive: boolean;
}

export interface ToppingGroup {
  id: string;
  name: string;
  selectionMode: ToppingSelectionMode;
  minSelect: number;
  maxSelect?: number | null;
  sortOrder?: number;
  isActive: boolean;
  toppings: Topping[];
}

export interface ToppingGroupRequest {
  name: string;
  selectionMode?: ToppingSelectionMode;
  minSelect?: number;
  maxSelect?: number | null;
  sortOrder?: number;
  isActive: boolean;
}

export interface ToppingRequest {
  groupId: string;
  name: string;
  priceMode?: ToppingPriceMode;
  defaultPrice: number;
  maxPrice?: number | null;
  sortOrder?: number;
  isActive: boolean;
}

export const toppingService = {
  // --- Groups ---
  getGroups: () =>
    api
      .get<ApiResponse<ToppingGroup[]>>("/restaurant/topping-groups")
      .then((res) => res.data.data),

  createGroup: (data: ToppingGroupRequest) =>
    api
      .post<ApiResponse<ToppingGroup>>("/restaurant/topping-groups", data)
      .then((res) => res.data.data),

  updateGroup: (id: string, data: ToppingGroupRequest) =>
    api
      .put<ApiResponse<ToppingGroup>>(`/restaurant/topping-groups/${id}`, data)
      .then((res) => res.data.data),

  deleteGroup: (id: string) =>
    api
      .delete<ApiResponse<void>>(`/restaurant/topping-groups/${id}`)
      .then((res) => res.data.data),

  // --- Toppings ---
  createTopping: (data: ToppingRequest) =>
    api
      .post<ApiResponse<Topping>>("/restaurant/toppings", data)
      .then((res) => res.data.data),

  updateTopping: (id: string, data: ToppingRequest) =>
    api
      .put<ApiResponse<Topping>>(`/restaurant/toppings/${id}`, data)
      .then((res) => res.data.data),

  deleteTopping: (id: string) =>
    api
      .delete<ApiResponse<void>>(`/restaurant/toppings/${id}`)
      .then((res) => res.data.data),

  // --- What the till asks when a dish is tapped ---

  /**
   * Ids of products that have any add-ons at all.
   *
   * One cached call, so a tile opens the picker only when it has questions to
   * ask. Without it the till would round-trip on every tap, or flash an empty
   * dialog at a retail cashier who has no toppings configured.
   */
  getProductIdsWithToppings: () =>
    api
      .get<ApiResponse<string[]>>("/restaurant/products/with-toppings")
      .then((res) => res.data.data),
  getGroupsForProduct: (productId: string) =>
    api
      .get<ApiResponse<ToppingGroup[]>>(`/restaurant/products/${productId}/topping-groups`)
      .then((res) => res.data.data),

  setGroupsForProduct: (productId: string, groupIds: string[]) =>
    api
      .put<ApiResponse<void>>(`/restaurant/products/${productId}/topping-groups`, groupIds)
      .then((res) => res.data.data),
};
