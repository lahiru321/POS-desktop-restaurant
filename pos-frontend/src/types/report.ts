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
  /** COUNTER is a sale rung with no tab or takeaway order. */
  orderType: OrderTypeName;
  /** "T4", "T1+T2"; null for takeaway and counter. */
  tableName: string | null;
  serviceChargeAmount: number;
  items: SalesReportItemRecord[];
}

export type OrderTypeName = "DINE_IN" | "TAKEAWAY" | "COUNTER";

export const ORDER_TYPE_LABELS: Record<OrderTypeName, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  COUNTER: "Counter",
};

export interface OrderTypeLine {
  orderType: OrderTypeName;
  bills: number;
  revenue: number;
  averageBill: number;
  sharePct: number;
  covers: number;
}

export interface VoidRecord {
  id: string;
  voidedAt: string;
  /** "#12 · T4" or "#13 · Takeaway". */
  orderLabel: string;
  itemName: string;
  quantity: number;
  /** How much of it the kitchen already had. */
  firedQuantity: number;
  amount: number;
  wholeTab: boolean;
  reason: string | null;
  voidedBy: string;
  approvedBy: string | null;
}

export interface RestaurantSummaryReport {
  bills: number;
  revenue: number;
  averageBill: number;
  covers: number;
  revenuePerCover: number;
  /** Always DINE_IN, TAKEAWAY, COUNTER, in that order. */
  orderTypes: OrderTypeLine[];
  serviceChargeCollected: number;
  serviceChargeWaivedBills: number;
  voidCount: number;
  voidedAmount: number;
  voidedAfterKitchenAmount: number;
  voidedTabs: number;
  /** Newest first. */
  voids: VoidRecord[];
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

/**
 * Add-ons sold and refunded in a period. The product reports leave these out
 * by design (an add-on row carries no product), so this is where that revenue shows.
 */
export interface ToppingSalesLine {
  toppingId: string;
  /** As named on the sales; the add-on may since be renamed or deleted. */
  name: string;
  portionsSold: number;
  revenue: number;
  portionsReturned: number;
  refunded: number;
  netRevenue: number;
}

export interface ToppingSalesReport {
  totalRevenue: number;
  totalRefunded: number;
  netRevenue: number;
  totalPortions: number;
  /** Sorted by net revenue, highest first. */
  toppings: ToppingSalesLine[];
}
