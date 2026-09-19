package com.lumora.pos.report.dto;

import lombok.Builder;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;

/**
 * DTOs for the Reporting Module
 */
public class ReportDtos {

    @Data
    @Builder
    public static class SalesReportRecord {
        private UUID saleId;
        private String invoiceNumber;
        private LocalDateTime createdAt;
        private String customerName;
        private String cashierName;
        private BigDecimal totalAmount;
        private BigDecimal taxAmount;
        private BigDecimal discountAmount;
        private BigDecimal netAmount;
        private String paymentMethod;
        private String paymentStatus;
        /** Gross cash the customer handed over (CASH/SPLIT). Null for card/online. */
        private BigDecimal amountTendered;
        /** Change given back = amountTendered − netAmount, floored at 0. */
        private BigDecimal changeDue;
        private List<SalesReportItemRecord> items;
    }

    @Data
    @Builder
    public static class SalesReportItemRecord {
        private UUID productId;
        private String productName;
        private String sku;
        private String description;
        private BigDecimal quantity;
        private BigDecimal unitPrice;
        private BigDecimal taxAmount;
        private BigDecimal discountAmount;
        private BigDecimal totalAmount;
    }

    @Data
    @Builder
    public static class InventoryValuationReport {
        private int totalProducts;
        private int totalStockItems;
        private BigDecimal totalCostValue; // stock * costPrice
        private BigDecimal totalRetailValue; // stock * basePrice
        private BigDecimal potentialProfit; // totalRetail - totalCost
        private List<CategoryValuation> categoryBreakdown;
    }

    @Data
    @Builder
    public static class CategoryValuation {
        private String categoryName;
        private int productCount;
        private int stockCount;
        private BigDecimal costValue;
        private BigDecimal retailValue;
    }

    // ── NEW REPORT DTOs ──────────────────────────────────────────────────────

    @Data
    @Builder
    public static class EmployeePerformanceRecord {
        private UUID userId;
        private String employeeName;
        private String email;
        private int transactionCount;
        private BigDecimal totalRevenue;
        private BigDecimal avgTransactionValue;
        private BigDecimal totalDiscount;
    }

    @Data
    @Builder
    public static class TopCustomerRecord {
        private UUID customerId;
        private String customerName;
        private String email;
        private String phone;
        private int transactionCount;
        private BigDecimal totalSpent;
        private int loyaltyPoints;
    }

    @Data
    @Builder
    public static class CustomerCreditRecord {
        private UUID customerId;
        private String customerName;
        private String email;
        private String phone;
        private BigDecimal creditLimit;
        private BigDecimal creditBalance;
        private BigDecimal availableCredit;
        private java.time.LocalDateTime lastRepaymentAt;
    }

    @Data
    @Builder
    public static class TaxSummaryReport {
        private BigDecimal totalTaxCollected;
        private int totalTransactions;
        private List<TaxLineItem> breakdown;
    }

    @Data
    @Builder
    public static class TaxLineItem {
        private String paymentMethod;
        private int transactionCount;
        private BigDecimal taxCollected;
        private BigDecimal grossRevenue;
    }

    @Data
    @Builder
    public static class ProfitabilityReport {
        private BigDecimal totalRevenue;
        private BigDecimal totalCost;
        private BigDecimal totalProfit;
        private BigDecimal overallMarginPct;
        private Page<ProductProfitRecord> products;
    }

    @Data
    @Builder
    public static class ProductProfitRecord {
        private UUID productId;
        private String productName;
        private String sku;
        private String category;
        private int unitsSold;
        private BigDecimal revenue;
        private BigDecimal costOfGoodsSold;
        private BigDecimal grossProfit;
        private BigDecimal marginPct;
    }

    @Data
    @Builder
    public static class SoldItemDetail {
        private UUID productId;
        private String productName;
        private String sku;
        private int unitsSold;
        private BigDecimal revenue;
        private BigDecimal cogs;
        private BigDecimal grossProfit;
        private BigDecimal marginPct;
    }

    @Data
    @Builder
    public static class SoldItemsBySupplierRecord {
        private UUID supplierId;            // null for the synthetic "(Unassigned)" bucket
        private String supplierName;
        private boolean supplierActive;     // false for unassigned
        private int productCount;
        private int totalUnitsSold;
        private BigDecimal totalRevenue;
        private BigDecimal totalCogs;
        private BigDecimal grossProfit;
        private BigDecimal marginPct;
        private List<SoldItemDetail> items;
    }

    @Data
    @Builder
    public static class SoldItemsBySupplierReport {
        private BigDecimal totalRevenue;
        private BigDecimal totalCogs;
        private BigDecimal totalProfit;
        private BigDecimal overallMarginPct;
        private int totalUnitsSold;
        private int supplierCount;                              // excludes unassigned
        private List<SoldItemsBySupplierRecord> suppliers;      // sorted desc by revenue
    }

    @Data
    @Builder
    public static class StockVarianceRecord {
        private UUID productId;
        private String productName;
        private String sku;
        private int reconciledUnits;   // shrinkage via RECONCILIATION (negative deltas)
        private int damagedUnits;      // shrinkage via DAMAGE
        private int stockOutUnits;     // shrinkage via manual STOCK_OUT
        private int totalLost;
        private BigDecimal costImpact; // totalLost * costPrice (0 if costPrice unset)
    }

    @Data
    @Builder
    public static class StockVarianceReport {
        private int totalUnitsLost;
        private BigDecimal estimatedCostLoss;
        private int productsAffected;
        private List<StockVarianceRecord> products;     // sorted desc by totalLost
    }

    @Data
    @Builder
    public static class CashReconciliationRecord {
        private UUID sessionId;
        private String cashierName;
        private LocalDateTime openedAt;
        private LocalDateTime closedAt;
        private BigDecimal openingBalance;
        private BigDecimal expectedBalance;
        private BigDecimal closingBalance;
        private BigDecimal variance;
        private String notes;
    }
}
