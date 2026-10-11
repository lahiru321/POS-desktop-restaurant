import api from "./api";
import { ApiResponse, Page } from "@/types/common";
import {
  SalesReportRecord,
  CustomerCreditRecord,
  TaxSummaryReport,
  ProfitabilityReport,
  CashReconciliationRecord,
  ToppingSalesReport,
  RestaurantSummaryReport,
} from "@/types/report";

/** Only include branchId in the query string when a specific branch is selected. */
const branchParam = (branchId?: string) => (branchId ? { branchId } : {});

/**
 * Reporting service
 */
export const reportService = {
  getSalesReport: (start: string, end: string, page = 0, size = 20, branchId?: string) =>
    api
      .get<ApiResponse<Page<SalesReportRecord>>>("/reports/sales", {
        params: { start, end, page, size, ...branchParam(branchId) },
      })
      .then((res) => res.data.data),

  getCustomerCredit: (page = 0, size = 20) =>
    api
      .get<ApiResponse<Page<CustomerCreditRecord>>>("/reports/customer-credit", {
        params: { page, size },
      })
      .then((res) => res.data.data),

  /** Dine-in vs takeaway vs counter, service charge, and every void. */
  getRestaurantSummary: (start: string, end: string, branchId?: string) =>
    api
      .get<ApiResponse<RestaurantSummaryReport>>("/reports/restaurant-summary", {
        params: { start, end, ...branchParam(branchId) },
      })
      .then((res) => res.data.data),

  getToppingSales: (start: string, end: string, branchId?: string) =>
    api
      .get<ApiResponse<ToppingSalesReport>>("/reports/topping-sales", {
        params: { start, end, ...branchParam(branchId) },
      })
      .then((res) => res.data.data),

  getTaxSummary: (start: string, end: string) =>
    api
      .get<ApiResponse<TaxSummaryReport>>("/reports/tax-summary", {
        params: { start, end },
      })
      .then((res) => res.data.data),

  getProfitabilityReport: (start: string, end: string, page = 0, size = 20, branchId?: string) =>
    api
      .get<ApiResponse<ProfitabilityReport>>("/reports/profitability", {
        params: { start, end, page, size, ...branchParam(branchId) },
      })
      .then((res) => res.data.data),

  getCashReconciliation: (start: string, end: string, page = 0, size = 20, branchId?: string) =>
    api
      .get<ApiResponse<Page<CashReconciliationRecord>>>("/reports/cash-reconciliation", {
        params: { start, end, page, size, ...branchParam(branchId) },
      })
      .then((res) => res.data.data),
};
