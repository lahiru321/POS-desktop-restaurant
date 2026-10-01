package com.lumora.pos.dashboard.dto;

import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.util.List;

/**
 * Comprehensive dashboard response containing all analytics data
 * needed for the overview page.
 */
@Data
@Builder
public class DashboardResponse {

    // --- KPI Cards ---
    private BigDecimal todaySales;
    private BigDecimal yesterdaySales;
    private int todayTransactions;
    private int yesterdayTransactions;
    private BigDecimal avgOrderValue;
    private BigDecimal yesterdayAvgOrderValue;
    private int activeProducts;
    private int totalProducts;

    // --- Charts ---
    private List<DailySalesTrend> salesTrend; // Last 7 days
    private List<TopProduct> topProducts; // Top 5 selling products
    private List<PaymentMethodBreakdown> paymentBreakdown; // Sales by payment method

    // --- Alerts & Activity ---
    private List<LowStockAlert> lowStockAlerts; // Products below threshold
    private List<RecentTransaction> recentTransactions; // Last 10 transactions

    // --- Financial snapshot (null when the tenant lacks the finance features) ---
    private FinancialSnapshot financials;

    @Data
    @Builder
    public static class FinancialSnapshot {
        private BigDecimal netProfitMtd;       // month-to-date net profit
        private BigDecimal cashSalesToday;     // sum of today's CASH-method sales
    }

    @Data
    @Builder
    public static class DailySalesTrend {
        private String date; // "2026-02-25"
        private String dayLabel; // "Tue"
        private BigDecimal revenue;
        private int orders;
    }

    @Data
    @Builder
    public static class TopProduct {
        private String productId;
        private String productName;
        private int quantitySold;
        private BigDecimal revenue;
    }

    @Data
    @Builder
    public static class PaymentMethodBreakdown {
        private String method; // "CASH", "CARD", etc.
        private BigDecimal amount;
        private int count;
    }

    @Data
    @Builder
    public static class LowStockAlert {
        /** PRODUCT (a packaged menu item) or INGREDIENT. */
        private String kind;
        /** The product's or ingredient's id; the field name predates ingredients. */
        private String productId;
        private String productName;
        private String sku;
        /** Decimal for ingredients (2.5 kg); whole for products. */
        private BigDecimal currentStock;
        private BigDecimal threshold;
        /** KG, L, ... for an ingredient; null for a product. */
        private String unit;
    }

    @Data
    @Builder
    public static class RecentTransaction {
        private String saleId;
        private String invoiceNumber;
        private BigDecimal netAmount;
        private String paymentMethod;
        private String paymentStatus;
        private String customerName;
        private String createdAt;
        private int itemCount;
    }
}
