/**
 * Reporting module types
 */

export interface SalesReportRecord {
  saleId: string;
  invoiceNumber: string;
  createdAt: string;
  customerName: string;
  cashierName: string;
  totalAmount: number;
  taxAmount: number;
  discountAmount: number;
  netAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  /** Gross cash the customer handed over (CASH/SPLIT). Null for card/online. */
  amountTendered?: number | null;
  /** Change given back = amountTendered − netAmount, floored at 0. */
  changeDue?: number | null;
  items: SalesReportItemRecord[];
}

export interface SalesReportItemRecord {
  productId: string;
  productName: string;
  sku: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
}

export interface InventoryValuationReport {
  totalProducts: number;
  totalStockItems: number;
  totalCostValue: number;
  totalRetailValue: number;
  potentialProfit: number;
  categoryBreakdown: CategoryValuation[];
}

export interface CategoryValuation {
  categoryName: string;
  productCount: number;
  stockCount: number;
  costValue: number;
  retailValue: number;
}

export interface EmployeePerformanceRecord {
  userId: string;
  employeeName: string;
  email: string;
  transactionCount: number;
  totalRevenue: number;
  avgTransactionValue: number;
  totalDiscount: number;
}

export interface TopCustomerRecord {
  customerId: string;
  customerName: string;
  email: string;
  phone: string;
  transactionCount: number;
  totalSpent: number;
  loyaltyPoints: number;
}

export interface CustomerCreditRecord {
  customerId: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  creditLimit: number;
  creditBalance: number;
  availableCredit: number;
  lastRepaymentAt: string | null;
}

export interface TaxLineItem {
  paymentMethod: string;
  transactionCount: number;
  taxCollected: number;
  grossRevenue: number;
}

export interface TaxSummaryReport {
  totalTaxCollected: number;
  totalTransactions: number;
  breakdown: TaxLineItem[];
}

export interface ProductProfitRecord {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  unitsSold: number;
  revenue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  marginPct: number;
}

export interface ProfitabilityReport {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  overallMarginPct: number;
  products: import("./common").Page<ProductProfitRecord>;
}

export interface SoldItemDetail {
  productId: string;
  productName: string;
  sku: string | null;
  unitsSold: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  marginPct: number;
}

export interface SoldItemsBySupplierRecord {
  supplierId: string | null;
  supplierName: string;
  supplierActive: boolean;
  productCount: number;
  totalUnitsSold: number;
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  marginPct: number;
  items: SoldItemDetail[];
}

export interface SoldItemsBySupplierReport {
  totalRevenue: number;
  totalCogs: number;
  totalProfit: number;
  overallMarginPct: number;
  totalUnitsSold: number;
  supplierCount: number;
  suppliers: SoldItemsBySupplierRecord[];
}

export interface StockVarianceRecord {
  productId: string;
  productName: string;
  sku: string | null;
  reconciledUnits: number;
  damagedUnits: number;
  stockOutUnits: number;
  totalLost: number;
  costImpact: number;
}

export interface StockVarianceReport {
  totalUnitsLost: number;
  estimatedCostLoss: number;
  productsAffected: number;
  products: StockVarianceRecord[];
}

export interface CashReconciliationRecord {
  sessionId: string;
  cashierName: string;
  openedAt: string;
  closedAt: string;
  openingBalance: number;
  expectedBalance: number | null;
  closingBalance: number | null;
  variance: number | null;
  notes: string | null;
}
