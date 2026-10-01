package com.lumora.pos.dashboard.service;

import com.lumora.pos.finance.dto.FinanceDtos.ProfitLossReport;
import com.lumora.pos.finance.service.FinanceService;
import com.lumora.pos.superadmin.repository.TenantConfigurationRepository;
import com.lumora.pos.tenant.TenantContext;
import com.lumora.pos.dashboard.dto.DashboardResponse;
import com.lumora.pos.dashboard.dto.DashboardResponse.*;
import com.lumora.pos.ingredient.service.IngredientService;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.sales.entity.SaleEntity;
import com.lumora.pos.sales.repository.SaleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Service providing aggregated analytics data for the dashboard.
 * All queries are scoped to the current tenant.
 */
@Service
@RequiredArgsConstructor
public class DashboardService {

    private final SaleRepository saleRepository;
    private final ProductRepository productRepository;
    private final FinanceService financeService;
    private final TenantConfigurationRepository tenantConfigurationRepository;
    private final IngredientService ingredientService;

    @Transactional(readOnly = true)
    public DashboardResponse getDashboardData() {
        UUID tenantId = TenantContext.getTenantId();

        // Date ranges
        LocalDate today = LocalDate.now();
        LocalDateTime todayStart = LocalDateTime.of(today, LocalTime.MIN);
        LocalDateTime todayEnd = LocalDateTime.of(today, LocalTime.MAX);
        LocalDateTime yesterdayStart = LocalDateTime.of(today.minusDays(1), LocalTime.MIN);
        LocalDateTime yesterdayEnd = LocalDateTime.of(today.minusDays(1), LocalTime.MAX);
        LocalDateTime weekStart = LocalDateTime.of(today.minusDays(6), LocalTime.MIN);

        // --- KPI Cards ---
        BigDecimal todaySales = saleRepository.sumNetAmountByTenantIdAndDateRange(tenantId, todayStart, todayEnd);
        BigDecimal yesterdaySales = saleRepository.sumNetAmountByTenantIdAndDateRange(tenantId, yesterdayStart,
                yesterdayEnd);
        int todayTransactions = saleRepository.countByTenantIdAndDateRange(tenantId, todayStart, todayEnd);
        int yesterdayTransactions = saleRepository.countByTenantIdAndDateRange(tenantId, yesterdayStart, yesterdayEnd);

        BigDecimal avgOrderValue = todayTransactions > 0
                ? todaySales.divide(BigDecimal.valueOf(todayTransactions), 2, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;
        BigDecimal yesterdayAvg = yesterdayTransactions > 0
                ? yesterdaySales.divide(BigDecimal.valueOf(yesterdayTransactions), 2, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;

        int activeProducts = productRepository.countActiveByTenantId(tenantId);
        int totalProducts = (int) productRepository.countByTenantId(tenantId);

        // --- Sales Trend (Last 7 days) ---
        List<DailySalesTrend> salesTrend = buildSalesTrend(tenantId, today);

        // --- Top 5 Products (Last 30 days) ---
        List<TopProduct> topProducts = buildTopProducts(tenantId, todayStart.minusDays(30), todayEnd);

        // --- Payment Method Breakdown (Today) ---
        List<PaymentMethodBreakdown> paymentBreakdown = buildPaymentBreakdown(tenantId, todayStart, todayEnd);

        // --- Low Stock Alerts (Top 10) ---
        List<LowStockAlert> lowStockAlerts = buildLowStockAlerts(tenantId);

        // --- Recent Transactions (Last 10) ---
        List<RecentTransaction> recentTransactions = buildRecentTransactions(tenantId);

        // --- Financial snapshot (only for tenants with the finance features) ---
        FinancialSnapshot financials = buildFinancialSnapshot(tenantId, today, paymentBreakdown);

        return DashboardResponse.builder()
                .todaySales(todaySales)
                .yesterdaySales(yesterdaySales)
                .todayTransactions(todayTransactions)
                .yesterdayTransactions(yesterdayTransactions)
                .avgOrderValue(avgOrderValue)
                .yesterdayAvgOrderValue(yesterdayAvg)
                .activeProducts(activeProducts)
                .totalProducts(totalProducts)
                .salesTrend(salesTrend)
                .topProducts(topProducts)
                .paymentBreakdown(paymentBreakdown)
                .lowStockAlerts(lowStockAlerts)
                .recentTransactions(recentTransactions)
                .financials(financials)
                .build();
    }

    /**
     * Builds the month-to-date financial snapshot. Returns null when the tenant
     * lacks the FINANCIAL_REPORTS feature.
     */
    private FinancialSnapshot buildFinancialSnapshot(UUID tenantId, LocalDate today,
                                                     List<PaymentMethodBreakdown> todayPayments) {
        boolean hasFinancials = tenantConfigurationRepository.findByTenantId(tenantId)
                .map(c -> c.hasFeature("FINANCIAL_REPORTS")).orElse(false);
        if (!hasFinancials) return null;

        LocalDate monthStart = today.withDayOfMonth(1);
        ProfitLossReport pnl = financeService.getProfitAndLoss(monthStart, today, null);

        BigDecimal cashSalesToday = todayPayments.stream()
                .filter(p -> SaleEntity.PaymentMethod.CASH.name().equals(p.getMethod()))
                .map(PaymentMethodBreakdown::getAmount)
                .findFirst()
                .orElse(BigDecimal.ZERO);

        return FinancialSnapshot.builder()
                .netProfitMtd(pnl.getNetProfit())
                .cashSalesToday(cashSalesToday)
                .build();
    }

    /**
     * Build 7-day sales trend with daily revenue and order count.
     */
    private List<DailySalesTrend> buildSalesTrend(UUID tenantId, LocalDate today) {
        List<DailySalesTrend> trend = new ArrayList<>();
        DateTimeFormatter dateF = DateTimeFormatter.ofPattern("yyyy-MM-dd");

        for (int i = 6; i >= 0; i--) {
            LocalDate date = today.minusDays(i);
            LocalDateTime start = LocalDateTime.of(date, LocalTime.MIN);
            LocalDateTime end = LocalDateTime.of(date, LocalTime.MAX);

            BigDecimal revenue = saleRepository.sumNetAmountByTenantIdAndDateRange(tenantId, start, end);
            int orders = saleRepository.countByTenantIdAndDateRange(tenantId, start, end);

            trend.add(DailySalesTrend.builder()
                    .date(date.format(dateF))
                    .dayLabel(date.getDayOfWeek().getDisplayName(TextStyle.SHORT, Locale.ENGLISH))
                    .revenue(revenue)
                    .orders(orders)
                    .build());
        }
        return trend;
    }

    /**
     * Top 5 selling products by quantity in the last 30 days.
     */
    private List<TopProduct> buildTopProducts(UUID tenantId, LocalDateTime start, LocalDateTime end) {
        List<Object[]> rows = saleRepository.findTopSellingProducts(tenantId, start, end, PageRequest.of(0, 5));

        List<UUID> productIds = rows.stream()
                .map(r -> (UUID) r[0])
                .collect(Collectors.toList());

        Map<UUID, String> productNames = productRepository
                .findAllByIdInAndTenantId(productIds, tenantId)
                .stream()
                .collect(Collectors.toMap(ProductEntity::getId, ProductEntity::getName));

        return rows.stream().filter(row -> row[0] != null).map(row -> {
            UUID productId = (UUID) row[0];
            BigDecimal qty = (BigDecimal) row[1];
            BigDecimal revenue = (BigDecimal) row[2];

            return TopProduct.builder()
                    .productId(productId.toString())
                    .productName(productNames.getOrDefault(productId, "Unknown"))
                    .quantitySold(qty.intValue())
                    .revenue(revenue)
                    .build();
        }).collect(Collectors.toList());
    }

    /**
     * Payment method breakdown for the given date range.
     */
    private List<PaymentMethodBreakdown> buildPaymentBreakdown(UUID tenantId, LocalDateTime start, LocalDateTime end) {
        List<Object[]> rows = saleRepository.findPaymentMethodBreakdown(tenantId, start, end);

        return rows.stream().map(row -> {
            SaleEntity.PaymentMethod method = (SaleEntity.PaymentMethod) row[0];
            Long count = (Long) row[1];
            BigDecimal amount = (BigDecimal) row[2];

            return PaymentMethodBreakdown.builder()
                    .method(method.name())
                    .count(count.intValue())
                    .amount(amount)
                    .build();
        }).collect(Collectors.toList());
    }

    /**
     * Low stock alerts — up to 10 packaged menu items, then up to 10 ingredients,
     * at or below their threshold.
     */
    private List<LowStockAlert> buildLowStockAlerts(UUID tenantId) {
        List<ProductEntity> lowStock = productRepository.findLowStockProducts(tenantId, PageRequest.of(0, 10));

        List<LowStockAlert> alerts = lowStock.stream().map(p -> LowStockAlert.builder()
                .kind("PRODUCT")
                .productId(p.getId().toString())
                .productName(p.getName())
                .sku(p.getSku())
                .currentStock(BigDecimal.valueOf(p.getStockQuantity()))
                .threshold(BigDecimal.valueOf(p.getLowStockThreshold()))
                .build()).collect(Collectors.toCollection(ArrayList::new));

        ingredientService.lowStockForTenant(tenantId, 10).forEach(i -> alerts.add(LowStockAlert.builder()
                .kind("INGREDIENT")
                .productId(i.getId().toString())
                .productName(i.getName())
                .currentStock(i.getQuantity())
                .threshold(i.getLowStockThreshold())
                .unit(i.getUnit().name())
                .build()));
        return alerts;
    }

    /**
     * 10 most recent transactions.
     */
    private List<RecentTransaction> buildRecentTransactions(UUID tenantId) {
        List<SaleEntity> recentSales = saleRepository.findRecentSales(tenantId, PageRequest.of(0, 10));
        DateTimeFormatter dtf = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

        return recentSales.stream().map(s -> RecentTransaction.builder()
                .saleId(s.getId().toString())
                .invoiceNumber(s.getInvoiceNumber())
                .netAmount(s.getNetAmount())
                .paymentMethod(s.getPaymentMethod().name())
                .paymentStatus(s.getPaymentStatus().name())
                .customerName(s.getCustomer() != null
                        ? s.getCustomer().getFirstName() + " " + s.getCustomer().getLastName()
                        : "Walk-in")
                .createdAt(s.getCreatedAt().format(dtf))
                .itemCount(s.getItems() != null ? s.getItems().size() : 0)
                .build()).collect(Collectors.toList());
    }
}
