package com.lumora.pos.report.service;

import com.lumora.pos.cashsession.entity.CashSessionEntity;
import com.lumora.pos.cashsession.repository.CashSessionRepository;
import com.lumora.pos.inventory.entity.InventoryAdjustmentEntity;
import com.lumora.pos.inventory.repository.InventoryAdjustmentRepository;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.purchase.entity.PurchaseOrderEntity;
import com.lumora.pos.purchase.repository.PurchaseOrderItemRepository;
import com.lumora.pos.report.dto.ReportDtos.*;
import com.lumora.pos.sales.entity.SaleEntity;
import com.lumora.pos.sales.entity.SaleItemEntity;
import com.lumora.pos.sales.repository.SaleRepository;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.customer.repository.CustomerRepository;
import com.lumora.pos.credit.repository.CreditTransactionRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class ReportService {

        private final SaleRepository saleRepository;
        private final ProductRepository productRepository;
        private final UserRepository userRepository;
        private final CustomerRepository customerRepository;
        private final CreditTransactionRepository creditTransactionRepository;
        private final PurchaseOrderItemRepository purchaseOrderItemRepository;
        private final InventoryAdjustmentRepository inventoryAdjustmentRepository;
        private final CashSessionRepository cashSessionRepository;
        private final BranchAccessGuard branchAccessGuard;

        /**
         * Get paginated sales history for a specific date range.
         */
        @Transactional(readOnly = true)
        public Page<SalesReportRecord> getSalesReport(LocalDateTime start, LocalDateTime end, UUID branchId, Pageable pageable) {
                UUID tenantId = TenantContext.getTenantId();
                Optional<Set<UUID>> branchFilter = branchAccessGuard.reportBranchFilter(branchId);
                Page<SaleEntity> sales = branchFilter.isPresent()
                                ? saleRepository.findByTenantIdAndCreatedAtBetweenAndBranch(tenantId, start, end, branchFilter.get(), pageable)
                                : saleRepository.findByTenantIdAndCreatedAtBetween(tenantId, start, end, pageable);

                // Batch fetch cashier names
                Set<UUID> cashierIds = sales.stream()
                                .map(SaleEntity::getCreatedBy)
                                .filter(Objects::nonNull)
                                .collect(Collectors.toSet());

                Map<UUID, String> cashierNames = new HashMap<>();
                if (!cashierIds.isEmpty()) {
                        userRepository.findAllById(cashierIds).forEach(user -> {
                                cashierNames.put(user.getId(), user.getFirstName() + " " + user.getLastName());
                        });
                }

                // Batch fetch product details for all sale items
                Set<UUID> productIds = sales.stream()
                                .flatMap(s -> s.getItems().stream())
                                .map(SaleItemEntity::getProductId)
                                .filter(Objects::nonNull)
                                .collect(Collectors.toSet());

                Map<UUID, ProductEntity> productMap = new HashMap<>();
                if (!productIds.isEmpty()) {
                        productRepository.findAllById(productIds).forEach(p -> productMap.put(p.getId(), p));
                }

                return sales.map(s -> mapToSalesReportRecord(s, cashierNames, productMap));
        }

        /**
         * Get current inventory valuation report.
         */
        @Transactional(readOnly = true)
        public InventoryValuationReport getInventoryValuation(UUID branchId) {
                UUID tenantId = TenantContext.getTenantId();
                Optional<Set<UUID>> branchFilter = branchAccessGuard.reportBranchFilter(branchId);
                List<Object[]> rows = branchFilter.isPresent()
                                ? productRepository.getInventoryValuationByCategoryAndBranch(tenantId, branchFilter.get())
                                : productRepository.getInventoryValuationByCategory(tenantId);

                List<CategoryValuation> breakdown = rows.stream().map(row -> {
                        String category = row[0] != null ? row[0].toString() : "Uncategorized";
                        long productCount = row[1] instanceof Number ? ((Number) row[1]).longValue() : 0L;
                        long stockCount = row[2] instanceof Number ? ((Number) row[2]).longValue() : 0L;
                        BigDecimal cost = row[3] instanceof BigDecimal ? (BigDecimal) row[3] : BigDecimal.ZERO;
                        BigDecimal retail = row[4] instanceof BigDecimal ? (BigDecimal) row[4] : BigDecimal.ZERO;

                        return CategoryValuation.builder()
                                        .categoryName(category)
                                        .productCount((int) productCount)
                                        .stockCount((int) stockCount)
                                        .costValue(cost)
                                        .retailValue(retail)
                                        .build();
                }).collect(Collectors.toList());

                BigDecimal totalCost = breakdown.stream().map(CategoryValuation::getCostValue).reduce(BigDecimal.ZERO,
                                BigDecimal::add);
                BigDecimal totalRetail = breakdown.stream().map(CategoryValuation::getRetailValue).reduce(
                                BigDecimal.ZERO,
                                BigDecimal::add);
                int totalProducts = breakdown.stream().mapToInt(CategoryValuation::getProductCount).sum();
                int totalStock = breakdown.stream().mapToInt(CategoryValuation::getStockCount).sum();

                return InventoryValuationReport.builder()
                                .totalProducts(totalProducts)
                                .totalStockItems(totalStock)
                                .totalCostValue(totalCost)
                                .totalRetailValue(totalRetail)
                                .potentialProfit(totalRetail.subtract(totalCost))
                                .categoryBreakdown(breakdown)
                                .build();
        }

        private SalesReportRecord mapToSalesReportRecord(SaleEntity s, Map<UUID, String> cashierNames,
                        Map<UUID, ProductEntity> productMap) {
                String cashierName = s.getCreatedBy() != null ? cashierNames.getOrDefault(s.getCreatedBy(), "Unknown")
                                : "System";

                List<SalesReportItemRecord> items = s.getItems().stream().map(item -> {
                        ProductEntity product = item.getProductId() != null ? productMap.get(item.getProductId()) : null;
                        String displayName = product != null ? product.getName()
                                        : (item.getItemName() != null && !item.getItemName().isBlank()
                                                        ? item.getItemName() : "Custom item");
                        return SalesReportItemRecord.builder()
                                        .productId(item.getProductId())
                                        .productName(displayName)
                                        .sku(product != null ? product.getSku() : null)
                                        .description(product != null ? product.getDescription() : null)
                                        .quantity(item.getQuantity())
                                        .unitPrice(item.getUnitPrice())
                                        .taxAmount(item.getTaxAmount())
                                        .discountAmount(item.getDiscountAmount())
                                        .totalAmount(item.getTotalAmount())
                                        .build();
                }).toList();

                return SalesReportRecord.builder()
                                .saleId(s.getId())
                                .invoiceNumber(s.getInvoiceNumber())
                                .createdAt(s.getCreatedAt())
                                .customerName(
                                                s.getCustomer() != null
                                                                ? s.getCustomer().getFirstName() + " "
                                                                                + s.getCustomer().getLastName()
                                                                : "Walk-in")
                                .cashierName(cashierName)
                                .totalAmount(s.getTotalAmount())
                                .taxAmount(s.getTaxAmount())
                                .discountAmount(s.getDiscountAmount())
                                .netAmount(s.getNetAmount())
                                .paymentMethod(s.getPaymentMethod().name())
                                .paymentStatus(s.getPaymentStatus().name())
                                .amountTendered(s.getAmountTendered())
                                .changeDue(s.getAmountTendered() != null
                                                ? s.getAmountTendered().subtract(s.getNetAmount())
                                                                .max(java.math.BigDecimal.ZERO)
                                                : null)
                                .items(items)
                                .build();
        }

        @Transactional(readOnly = true)
        public Page<EmployeePerformanceRecord> getEmployeePerformance(LocalDateTime start, LocalDateTime end, UUID branchId, Pageable pageable) {
                UUID tenantId = TenantContext.getTenantId();
                Optional<Set<UUID>> branchFilter = branchAccessGuard.reportBranchFilter(branchId);
                Page<Object[]> results = branchFilter.isPresent()
                                ? saleRepository.aggregateEmployeePerformanceByBranch(tenantId, start, end, branchFilter.get(), pageable)
                                : saleRepository.aggregateEmployeePerformance(tenantId, start, end, pageable);

                // Batch fetch cashier names for the current page
                Set<UUID> cashierIds = results.stream()
                                .map(row -> (UUID) row[0])
                                .filter(Objects::nonNull)
                                .collect(Collectors.toSet());

                Map<UUID, String> userNames = new HashMap<>();
                Map<UUID, String> userEmails = new HashMap<>();
                if (!cashierIds.isEmpty()) {
                        userRepository.findAllById(cashierIds).forEach(u -> {
                                userNames.put(u.getId(), u.getFirstName() + " " + u.getLastName());
                                userEmails.put(u.getId(), u.getEmail());
                        });
                }

                return results.map(row -> EmployeePerformanceRecord.builder()
                                .userId((UUID) row[0])
                                .employeeName(userNames.getOrDefault(row[0], "Unknown"))
                                .email(userEmails.getOrDefault(row[0], ""))
                                .transactionCount(((Number) row[1]).intValue())
                                .totalRevenue((BigDecimal) row[2])
                                .avgTransactionValue(BigDecimal.valueOf(((Number) row[3]).doubleValue()).setScale(2,
                                                RoundingMode.HALF_UP))
                                .totalDiscount((BigDecimal) row[4])
                                .build());
        }

        @Transactional(readOnly = true)
        public Page<TopCustomerRecord> getTopCustomers(Pageable pageable) {
                UUID tenantId = TenantContext.getTenantId();
                Page<Object[]> results = saleRepository.aggregateTopCustomers(tenantId, pageable);

                return results.map(row -> TopCustomerRecord.builder()
                                .customerId((UUID) row[0])
                                .customerName((String) row[1])
                                .email((String) row[2])
                                .phone((String) row[3])
                                .transactionCount(((Number) row[4]).intValue())
                                .totalSpent((BigDecimal) row[5])
                                .loyaltyPoints(((Number) row[6]).intValue())
                                .build());
        }

        /**
         * Accounts-receivable report: every customer with a store-credit account
         * (a limit granted or a balance owed), highest outstanding first.
         */
        @Transactional(readOnly = true)
        public Page<CustomerCreditRecord> getCustomerCredit(Pageable pageable) {
                UUID tenantId = TenantContext.getTenantId();
                return customerRepository.findCreditAccounts(tenantId, pageable)
                                .map(c -> {
                                        BigDecimal limit = c.getCreditLimit() != null ? c.getCreditLimit() : BigDecimal.ZERO;
                                        BigDecimal balance = c.getCreditBalance() != null ? c.getCreditBalance() : BigDecimal.ZERO;
                                        return CustomerCreditRecord.builder()
                                                        .customerId(c.getId())
                                                        .customerName((c.getFirstName() + " "
                                                                        + (c.getLastName() != null ? c.getLastName() : "")).trim())
                                                        .email(c.getEmail())
                                                        .phone(c.getPhone())
                                                        .creditLimit(limit)
                                                        .creditBalance(balance)
                                                        .availableCredit(limit.subtract(balance).max(BigDecimal.ZERO))
                                                        .lastRepaymentAt(creditTransactionRepository
                                                                        .findLastRepaymentAt(c.getId(), tenantId))
                                                        .build();
                                });
        }

        @Transactional(readOnly = true)
        public TaxSummaryReport getTaxSummary(LocalDateTime start, LocalDateTime end) {
                UUID tenantId = TenantContext.getTenantId();
                List<Object[]> results = saleRepository.aggregateTaxSummary(tenantId, start, end);

                List<TaxLineItem> breakdown = results.stream().map(row -> TaxLineItem.builder()
                                .paymentMethod(row[0].toString())
                                .transactionCount(((Number) row[1]).intValue())
                                .taxCollected((BigDecimal) row[2])
                                .grossRevenue((BigDecimal) row[3])
                                .build()).toList();

                BigDecimal totalTax = breakdown.stream()
                                .map(TaxLineItem::getTaxCollected).reduce(BigDecimal.ZERO, BigDecimal::add);

                return TaxSummaryReport.builder()
                                .totalTaxCollected(totalTax)
                                .totalTransactions(breakdown.stream().mapToInt(TaxLineItem::getTransactionCount).sum())
                                .breakdown(breakdown)
                                .build();
        }

        @Transactional(readOnly = true)
        public ProfitabilityReport getProfitabilityReport(LocalDateTime start, LocalDateTime end, UUID branchId, Pageable pageable) {
                UUID tenantId = TenantContext.getTenantId();
                Optional<Set<UUID>> branchFilter = branchAccessGuard.reportBranchFilter(branchId);

                // 1. Calculate overall summary for the period (Revenue, COGS, Profit)
                List<Object[]> allResults = branchFilter.isPresent()
                                ? saleRepository.aggregateProductProfitabilityByBranch(tenantId, start, end, branchFilter.get())
                                : saleRepository.aggregateProductProfitability(tenantId, start, end);
                Set<UUID> allPids = allResults.stream().map(row -> (UUID) row[0]).collect(Collectors.toSet());

                Map<UUID, ProductEntity> allProductMap = new HashMap<>();
                if (!allPids.isEmpty()) {
                        productRepository.findAllById(allPids).forEach(p -> allProductMap.put(p.getId(), p));
                }

                BigDecimal totalRevenue = BigDecimal.ZERO;
                BigDecimal totalCogs = BigDecimal.ZERO;

                for (Object[] row : allResults) {
                        UUID pid = (UUID) row[0];
                        int units = ((Number) row[1]).intValue();
                        BigDecimal revenue = (BigDecimal) row[2];
                        ProductEntity p = allProductMap.get(pid);

                        BigDecimal costPrice = p != null && p.getCostPrice() != null ? p.getCostPrice() : BigDecimal.ZERO;
                        BigDecimal cogs = costPrice.multiply(BigDecimal.valueOf(units));

                        totalRevenue = totalRevenue.add(revenue);
                        totalCogs = totalCogs.add(cogs);
                }

                BigDecimal totalProfit = totalRevenue.subtract(totalCogs);
                BigDecimal overallMargin = totalRevenue.compareTo(BigDecimal.ZERO) != 0
                                ? totalProfit.divide(totalRevenue, 4, RoundingMode.HALF_UP)
                                                .multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP)
                                : BigDecimal.ZERO;

                // 2. Get paginated results for the current page
                Page<Object[]> paginatedResults = branchFilter.isPresent()
                                ? saleRepository.aggregateProductProfitabilityByBranch(tenantId, start, end, branchFilter.get(), pageable)
                                : saleRepository.aggregateProductProfitability(tenantId, start, end, pageable);

                Page<ProductProfitRecord> productPage = paginatedResults.map(row -> {
                        UUID pid = (UUID) row[0];
                        BigDecimal revenue = (BigDecimal) row[2];
                        int units = ((Number) row[1]).intValue();
                        ProductEntity p = allProductMap.get(pid); // Reuse the map from summary fetch

                        BigDecimal costPrice = p != null && p.getCostPrice() != null ? p.getCostPrice() : BigDecimal.ZERO;
                        BigDecimal cogs = costPrice.multiply(BigDecimal.valueOf(units));
                        BigDecimal profit = revenue.subtract(cogs);
                        BigDecimal margin = revenue.compareTo(BigDecimal.ZERO) != 0
                                        ? profit.divide(revenue, 4, RoundingMode.HALF_UP)
                                                        .multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP)
                                        : BigDecimal.ZERO;

                        return ProductProfitRecord.builder()
                                        .productId(pid)
                                        .productName(p != null ? p.getName() : "Unknown")
                                        .sku(p != null ? p.getSku() : "")
                                        .category(p != null && p.getCategory() != null ? p.getCategory().getName()
                                                        : "Uncategorized")
                                        .unitsSold(units)
                                        .revenue(revenue)
                                        .costOfGoodsSold(cogs)
                                        .grossProfit(profit)
                                        .marginPct(margin)
                                        .build();
                });

                return ProfitabilityReport.builder()
                                .totalRevenue(totalRevenue)
                                .totalCost(totalCogs)
                                .totalProfit(totalProfit)
                                .overallMarginPct(overallMargin)
                                .products(productPage)
                                .build();
        }

        /**
         * Sold items grouped by supplier. Each product is attributed to the supplier of
         * its most recent non-DRAFT/non-CANCELLED PurchaseOrder. Products with no such
         * PO fall into a synthetic "(Unassigned)" bucket.
         */
        @Transactional(readOnly = true)
        public SoldItemsBySupplierReport getSoldItemsBySupplier(LocalDateTime start, LocalDateTime end) {
                UUID tenantId = TenantContext.getTenantId();

                List<Object[]> productSales = saleRepository.aggregateProductProfitability(tenantId, start, end);
                if (productSales.isEmpty()) {
                        return SoldItemsBySupplierReport.builder()
                                        .totalRevenue(BigDecimal.ZERO)
                                        .totalCogs(BigDecimal.ZERO)
                                        .totalProfit(BigDecimal.ZERO)
                                        .overallMarginPct(BigDecimal.ZERO)
                                        .totalUnitsSold(0)
                                        .supplierCount(0)
                                        .suppliers(List.of())
                                        .build();
                }

                Set<UUID> productIds = productSales.stream()
                                .map(r -> (UUID) r[0])
                                .collect(Collectors.toSet());

                Map<UUID, ProductEntity> productMap = new HashMap<>();
                productRepository.findAllById(productIds).forEach(p -> productMap.put(p.getId(), p));

                // Resolve product -> latest supplier (first row per product in DESC-ordered result is newest).
                Map<UUID, SupplierAttribution> productToSupplier = new HashMap<>();
                List<Object[]> supplierRows = purchaseOrderItemRepository.findLatestSupplierForProducts(
                                tenantId, productIds,
                                List.of(PurchaseOrderEntity.POStatus.ORDERED,
                                                PurchaseOrderEntity.POStatus.PARTIAL,
                                                PurchaseOrderEntity.POStatus.RECEIVED));
                for (Object[] row : supplierRows) {
                        UUID productId = (UUID) row[0];
                        productToSupplier.putIfAbsent(productId, new SupplierAttribution(
                                        (UUID) row[1],
                                        (String) row[2],
                                        row[3] != null && (Boolean) row[3]));
                }

                // Group per-product sales stats by supplier (null key = unassigned).
                Map<UUID, List<SoldItemDetail>> bySupplier = new LinkedHashMap<>();
                Map<UUID, SupplierAttribution> supplierInfo = new HashMap<>();

                BigDecimal totalRevenue = BigDecimal.ZERO;
                BigDecimal totalCogs = BigDecimal.ZERO;
                int totalUnits = 0;

                for (Object[] row : productSales) {
                        UUID pid = (UUID) row[0];
                        int units = ((Number) row[1]).intValue();
                        BigDecimal revenue = row[2] != null ? (BigDecimal) row[2] : BigDecimal.ZERO;

                        ProductEntity p = productMap.get(pid);
                        BigDecimal costPrice = p != null && p.getCostPrice() != null ? p.getCostPrice() : BigDecimal.ZERO;
                        BigDecimal cogs = costPrice.multiply(BigDecimal.valueOf(units));
                        BigDecimal profit = revenue.subtract(cogs);
                        BigDecimal margin = revenue.compareTo(BigDecimal.ZERO) != 0
                                        ? profit.divide(revenue, 4, RoundingMode.HALF_UP)
                                                        .multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP)
                                        : BigDecimal.ZERO;

                        SoldItemDetail detail = SoldItemDetail.builder()
                                        .productId(pid)
                                        .productName(p != null ? p.getName() : "Unknown Product")
                                        .sku(p != null ? p.getSku() : null)
                                        .unitsSold(units)
                                        .revenue(revenue)
                                        .cogs(cogs)
                                        .grossProfit(profit)
                                        .marginPct(margin)
                                        .build();

                        SupplierAttribution attr = productToSupplier.get(pid);
                        UUID groupKey = attr != null ? attr.supplierId : null;
                        if (attr != null) {
                                supplierInfo.putIfAbsent(groupKey, attr);
                        }
                        bySupplier.computeIfAbsent(groupKey, k -> new ArrayList<>()).add(detail);

                        totalRevenue = totalRevenue.add(revenue);
                        totalCogs = totalCogs.add(cogs);
                        totalUnits += units;
                }

                List<SoldItemsBySupplierRecord> records = new ArrayList<>();
                for (Map.Entry<UUID, List<SoldItemDetail>> entry : bySupplier.entrySet()) {
                        UUID supplierId = entry.getKey();
                        List<SoldItemDetail> items = entry.getValue();
                        items.sort(Comparator.comparing(SoldItemDetail::getRevenue).reversed());

                        BigDecimal supRevenue = items.stream().map(SoldItemDetail::getRevenue)
                                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                        BigDecimal supCogs = items.stream().map(SoldItemDetail::getCogs)
                                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                        BigDecimal supProfit = supRevenue.subtract(supCogs);
                        BigDecimal supMargin = supRevenue.compareTo(BigDecimal.ZERO) != 0
                                        ? supProfit.divide(supRevenue, 4, RoundingMode.HALF_UP)
                                                        .multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP)
                                        : BigDecimal.ZERO;
                        int supUnits = items.stream().mapToInt(SoldItemDetail::getUnitsSold).sum();

                        SupplierAttribution attr = supplierId != null ? supplierInfo.get(supplierId) : null;
                        records.add(SoldItemsBySupplierRecord.builder()
                                        .supplierId(supplierId)
                                        .supplierName(attr != null ? attr.supplierName : "(Unassigned)")
                                        .supplierActive(attr != null && attr.supplierActive)
                                        .productCount(items.size())
                                        .totalUnitsSold(supUnits)
                                        .totalRevenue(supRevenue)
                                        .totalCogs(supCogs)
                                        .grossProfit(supProfit)
                                        .marginPct(supMargin)
                                        .items(items)
                                        .build());
                }

                records.sort(Comparator.comparing(SoldItemsBySupplierRecord::getTotalRevenue).reversed());

                BigDecimal overallMargin = totalRevenue.compareTo(BigDecimal.ZERO) != 0
                                ? totalRevenue.subtract(totalCogs)
                                                .divide(totalRevenue, 4, RoundingMode.HALF_UP)
                                                .multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP)
                                : BigDecimal.ZERO;

                int namedSupplierCount = (int) records.stream()
                                .filter(r -> r.getSupplierId() != null).count();

                return SoldItemsBySupplierReport.builder()
                                .totalRevenue(totalRevenue)
                                .totalCogs(totalCogs)
                                .totalProfit(totalRevenue.subtract(totalCogs))
                                .overallMarginPct(overallMargin)
                                .totalUnitsSold(totalUnits)
                                .supplierCount(namedSupplierCount)
                                .suppliers(records)
                                .build();
        }

        /**
         * Stock variance / shrinkage report. Aggregates negative-delta inventory
         * adjustments (RECONCILIATION, DAMAGE, manual STOCK_OUT) to surface
         * unexpected outflows. Sales deductions are deliberately excluded — those
         * are expected and would drown the signal.
         */
        @Transactional(readOnly = true)
        public StockVarianceReport getStockVariance(LocalDateTime start, LocalDateTime end, UUID branchId) {
                UUID tenantId = TenantContext.getTenantId();
                Optional<Set<UUID>> branchFilter = branchAccessGuard.reportBranchFilter(branchId);

                List<Object[]> rows = branchFilter.isPresent()
                                ? inventoryAdjustmentRepository.aggregateShrinkageByProductAndTypeAndBranch(tenantId, start, end, branchFilter.get())
                                : inventoryAdjustmentRepository.aggregateShrinkageByProductAndType(tenantId, start, end);

                if (rows.isEmpty()) {
                        return StockVarianceReport.builder()
                                        .totalUnitsLost(0)
                                        .estimatedCostLoss(BigDecimal.ZERO)
                                        .productsAffected(0)
                                        .products(List.of())
                                        .build();
                }

                Set<UUID> productIds = rows.stream()
                                .map(r -> (UUID) r[0])
                                .collect(Collectors.toSet());

                Map<UUID, ProductEntity> productMap = new HashMap<>();
                productRepository.findAllById(productIds).forEach(p -> productMap.put(p.getId(), p));

                Map<UUID, int[]> perProduct = new HashMap<>(); // [reconciled, damaged, stockOut]
                for (Object[] row : rows) {
                        UUID pid = (UUID) row[0];
                        InventoryAdjustmentEntity.AdjustmentType type = (InventoryAdjustmentEntity.AdjustmentType) row[1];
                        int units = ((Number) row[2]).intValue();

                        int[] buckets = perProduct.computeIfAbsent(pid, k -> new int[3]);
                        switch (type) {
                                case RECONCILIATION -> buckets[0] += units;
                                case DAMAGE -> buckets[1] += units;
                                case STOCK_OUT -> buckets[2] += units;
                                default -> { /* unreachable: query filters to these three */ }
                        }
                }

                List<StockVarianceRecord> records = perProduct.entrySet().stream().map(entry -> {
                        UUID pid = entry.getKey();
                        int[] buckets = entry.getValue();
                        int total = buckets[0] + buckets[1] + buckets[2];
                        ProductEntity p = productMap.get(pid);

                        BigDecimal costPrice = p != null && p.getCostPrice() != null
                                        ? p.getCostPrice()
                                        : BigDecimal.ZERO;
                        BigDecimal costImpact = costPrice.multiply(BigDecimal.valueOf(total))
                                        .setScale(2, RoundingMode.HALF_UP);

                        return StockVarianceRecord.builder()
                                        .productId(pid)
                                        .productName(p != null ? p.getName() : "Unknown Product")
                                        .sku(p != null ? p.getSku() : null)
                                        .reconciledUnits(buckets[0])
                                        .damagedUnits(buckets[1])
                                        .stockOutUnits(buckets[2])
                                        .totalLost(total)
                                        .costImpact(costImpact)
                                        .build();
                }).sorted(Comparator.comparingInt(StockVarianceRecord::getTotalLost).reversed())
                  .collect(Collectors.toList());

                int totalUnitsLost = records.stream().mapToInt(StockVarianceRecord::getTotalLost).sum();
                BigDecimal totalCost = records.stream().map(StockVarianceRecord::getCostImpact)
                                .reduce(BigDecimal.ZERO, BigDecimal::add);

                return StockVarianceReport.builder()
                                .totalUnitsLost(totalUnitsLost)
                                .estimatedCostLoss(totalCost)
                                .productsAffected(records.size())
                                .products(records)
                                .build();
        }

        @Transactional(readOnly = true)
        public Page<CashReconciliationRecord> getCashReconciliation(
                        LocalDateTime start, LocalDateTime end, UUID branchId, Pageable pageable) {
                UUID tenantId = TenantContext.getTenantId();
                Optional<Set<UUID>> branchFilter = branchAccessGuard.reportBranchFilter(branchId);
                Page<CashSessionEntity> sessions = branchFilter.isPresent()
                        ? cashSessionRepository.findClosedByTenantIdAndDateRangeAndBranch(tenantId, start, end, branchFilter.get(), pageable)
                        : cashSessionRepository.findClosedByTenantIdAndDateRange(tenantId, start, end, pageable);

                Set<UUID> userIds = sessions.stream()
                        .map(CashSessionEntity::getUserId)
                        .filter(Objects::nonNull)
                        .collect(Collectors.toSet());
                Map<UUID, String> userNames = new HashMap<>();
                if (!userIds.isEmpty()) {
                        userRepository.findAllById(userIds).forEach(u ->
                                userNames.put(u.getId(), u.getFirstName() + " " + u.getLastName()));
                }

                return sessions.map(cs -> CashReconciliationRecord.builder()
                        .sessionId(cs.getId())
                        .cashierName(userNames.getOrDefault(cs.getUserId(), "Unknown"))
                        .openedAt(cs.getOpenedAt())
                        .closedAt(cs.getClosedAt())
                        .openingBalance(cs.getOpeningBalance())
                        .expectedBalance(cs.getExpectedBalance())
                        .closingBalance(cs.getClosingBalance())
                        .variance(cs.getVariance())
                        .notes(cs.getNotes())
                        .build());
        }

        private static final class SupplierAttribution {
                final UUID supplierId;
                final String supplierName;
                final boolean supplierActive;

                SupplierAttribution(UUID supplierId, String supplierName, boolean supplierActive) {
                        this.supplierId = supplierId;
                        this.supplierName = supplierName;
                        this.supplierActive = supplierActive;
                }
        }
}
