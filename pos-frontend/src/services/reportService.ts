import api from "./api";
import { ApiResponse, Page } from "@/types/common";
import {
  SalesReportRecord,
  InventoryValuationReport,
  EmployeePerformanceRecord,
  TopCustomerRecord,
  CustomerCreditRecord,
  TaxSummaryReport,
  ProfitabilityReport,
  SoldItemsBySupplierReport,
  StockVarianceReport,
  CashReconciliationRecord,
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

  getInventoryValuation: (branchId?: string) =>
    api
      .get<ApiResponse<InventoryValuationReport>>("/reports/inventory-valuation", {
        params: { ...branchParam(branchId) },
      })
      .then((res) => res.data.data),

  getEmployeePerformance: (start: string, end: string, page = 0, size = 20, branchId?: string) =>
    api
      .get<ApiResponse<Page<EmployeePerformanceRecord>>>("/reports/employee-performance", {
        params: { start, end, page, size, ...branchParam(branchId) },
      })
      .then((res) => res.data.data),

  getTopCustomers: (page = 0, size = 20) =>
    api
      .get<ApiResponse<Page<TopCustomerRecord>>>("/reports/top-customers", {
        params: { page, size },
      })
      .then((res) => res.data.data),

  getCustomerCredit: (page = 0, size = 20) =>
    api
      .get<ApiResponse<Page<CustomerCreditRecord>>>("/reports/customer-credit", {
        params: { page, size },
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

  getSoldItemsBySupplier: (start: string, end: string) =>
    api
      .get<ApiResponse<SoldItemsBySupplierReport>>("/reports/sold-items-by-supplier", {
        params: { start, end },
      })
      .then((res) => res.data.data),

  getStockVariance: (start: string, end: string, branchId?: string) =>
    api
      .get<ApiResponse<StockVarianceReport>>("/reports/stock-variance", {
        params: { start, end, ...branchParam(branchId) },
      })
      .then((res) => res.data.data),

  getCashReconciliation: (start: string, end: string, page = 0, size = 20, branchId?: string) =>
    api
      .get<ApiResponse<Page<CashReconciliationRecord>>>("/reports/cash-reconciliation", {
        params: { start, end, page, size, ...branchParam(branchId) },
      })
      .then((res) => res.data.data),
};
