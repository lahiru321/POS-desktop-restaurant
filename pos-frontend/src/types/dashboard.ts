/**
 * Dashboard analytics types — mirrors the backend DashboardResponse DTO.
 */

export interface DashboardData {
  // KPI Cards
  todaySales: number;
  yesterdaySales: number;
  todayTransactions: number;
  yesterdayTransactions: number;
  avgOrderValue: number;
  yesterdayAvgOrderValue: number;
  activeProducts: number;
  totalProducts: number;

  // Charts
  salesTrend: DailySalesTrend[];
  topProducts: TopProduct[];
  paymentBreakdown: PaymentMethodBreakdown[];

  // Alerts & Activity
  lowStockAlerts: LowStockAlert[];
  recentTransactions: RecentTransaction[];

  // Financial snapshot — null when the tenant lacks the finance features
  financials?: FinancialSnapshot | null;
}

export interface FinancialSnapshot {
  netProfitMtd: number | null;
  cashSalesToday: number | null;
}

export interface DailySalesTrend {
  date: string;       // "2026-02-25"
  dayLabel: string;   // "Tue"
  revenue: number;
  orders: number;
}

export interface TopProduct {
  productId: string;
  productName: string;
  quantitySold: number;
  revenue: number;
}

export interface PaymentMethodBreakdown {
  method: string;     // "CASH", "CARD", "ONLINE", etc.
  amount: number;
  count: number;
}

export interface LowStockAlert {
  /** PRODUCT (a packaged menu item) or INGREDIENT. */
  kind: 'PRODUCT' | 'INGREDIENT';
  /** The product's or ingredient's id. */
  productId: string;
  productName: string;
  sku?: string | null;
  /** Decimal for an ingredient (2.5 kg). */
  currentStock: number;
  threshold: number;
  /** KG, L, ... for an ingredient. */
  unit?: string | null;
}

export interface RecentTransaction {
  saleId: string;
  invoiceNumber: string;
  netAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  customerName: string;
  cashierName: string;
  createdAt: string;
  itemCount: number;
}
