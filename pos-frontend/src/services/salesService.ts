import api from "./api";
import { ApiResponse } from "@/types/common";

/**
 * One add-on on a line.
 *
 * `unitPrice` is only consulted for a topping whose stored price_mode is PROMPT.
 * For a FIXED topping the server bills its configured price and discards this
 * value, so sending it is harmless but pointless.
 */
export interface SaleItemToppingRequest {
  toppingId: string;
  /** Per parent unit — "double cheese" is 2. */
  quantity: number;
  unitPrice?: number;
}

export interface SaleItemRequest {
  /** Catalog product id; null/omitted for a custom/open line (then itemName is set). */
  productId: string | null;
  /** Typed name for a custom/open line; omit for catalog products. */
  itemName?: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  /** Free text for the kitchen and the bill. */
  notes?: string;
  /** Each becomes its own child sale_items row. */
  toppings?: SaleItemToppingRequest[];
}

export interface SaleRequest {
  customerId?: string;
  branchId?: string;
  paymentMethod: 'CASH' | 'CARD' | 'ONLINE' | 'SPLIT' | 'CREDIT';
  /** Cash amount tendered. Required for SPLIT; backend auto-fills netAmount for
   *  pure CASH sales when omitted; ignored for CARD/ONLINE. */
  cashTendered?: number;
  /** Loyalty points to redeem on this sale (requires customerId). Backend caps it
   *  to the balance and the bill and recomputes the discount. Omit / 0 = none. */
  pointsToRedeem?: number;
  items: SaleItemRequest[];
}

export interface SaleItemResponse {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount: number;
  /** The dish this add-on modifies; null for a top-level line. */
  parentItemId?: string | null;
  /**
   * Set when this line is an add-on. Both a topping and a custom/open line carry
   * a null productId, so this is what tells the receipt which it is.
   */
  toppingId?: string | null;
  sortOrder?: number;
  notes?: string | null;
}

export interface SaleResponse {
  id: string;
  invoiceNumber: string;
  totalAmount: number;
  taxAmount: number;
  discountAmount: number;
  netAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  /** Gross cash the customer handed over (CASH/SPLIT). Null/absent for card/online. */
  amountTendered?: number | null;
  /** Change given back = amountTendered − netAmount, floored at 0. */
  changeDue?: number | null;
  createdAt: string;
  cashierName?: string;
  customerId?: string;
  customerName?: string;
  earnedPoints?: number;
  loyaltyBalance?: number;
  /** Points the customer spent on this sale (0 when none). */
  pointsRedeemed?: number;
  /** Bill reduction the redeemed points bought (post-tax). */
  loyaltyDiscountAmount?: number;
  /** True if prices were VAT-inclusive (taxAmount extracted from netAmount)
   *  rather than added on top. Drives the receipt's VAT breakdown. */
  taxInclusive?: boolean;
  items: SaleItemResponse[];
}

export interface SalesSummaryResponse {
  totalOrders: number;
  totalGrossSales: number;
  totalTax: number;
  totalDiscounts: number;
  totalNetSales: number;
  salesByPaymentMethod: Record<string, number>;
}

export interface PaymentCorrectionRequest {
  paymentMethod?: 'CASH' | 'CARD' | 'ONLINE' | 'SPLIT' | 'CREDIT';
  cashTendered?: number;
  managerPin?: string;
}

export const salesService = {
  createSale: (data: SaleRequest) =>
    api.post<ApiResponse<SaleResponse>>("/sales", data).then(res => res.data.data),

  getSale: (id: string) =>
    api.get<ApiResponse<SaleResponse>>(`/sales/${id}`).then(res => res.data.data),

  /** Sales from the current cashier's open shift, newest first — the candidate
   *  list for the payment-correction picker. Empty when no shift is open. */
  getCurrentSessionSales: () =>
    api.get<ApiResponse<SaleResponse[]>>("/sales/session/current").then(res => res.data.data),

  getSalesByCustomer: (customerId: string, page: number = 0, size: number = 10) =>
    api.get<ApiResponse<{ content: SaleResponse[]; totalElements: number; totalPages: number }>>(`/sales/customer/${customerId}?page=${page}&size=${size}&sort=createdAt,desc`).then(res => res.data.data),

  getDailySummary: () =>
    api.get<ApiResponse<SalesSummaryResponse>>("/sales/summary/daily").then(res => res.data.data),

  correctPayment: (id: string, data: PaymentCorrectionRequest) =>
    api.patch<ApiResponse<SaleResponse>>(`/sales/${id}/payment-correction`, data).then(res => res.data.data),
};
