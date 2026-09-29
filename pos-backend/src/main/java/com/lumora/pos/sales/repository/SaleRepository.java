package com.lumora.pos.sales.repository;

import com.lumora.pos.sales.entity.SaleEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SaleRepository extends JpaRepository<SaleEntity, UUID> {

    Optional<SaleEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    Page<SaleEntity> findByTenantIdAndCreatedAtBetween(UUID tenantId, LocalDateTime start, LocalDateTime end,
            Pageable pageable);

    @Query("SELECT s FROM SaleEntity s WHERE s.tenantId = :tenantId " +
            "AND s.createdAt BETWEEN :start AND :end AND s.branch.id IN :branchIds")
    Page<SaleEntity> findByTenantIdAndCreatedAtBetweenAndBranch(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start,
            @Param("end") LocalDateTime end,
            @Param("branchIds") Collection<UUID> branchIds,
            Pageable pageable);

    List<SaleEntity> findByTenantIdAndCreatedAtBetween(UUID tenantId, LocalDateTime start, LocalDateTime end);

    Page<SaleEntity> findByCustomerIdAndTenantIdOrderByCreatedAtDesc(UUID customerId, UUID tenantId, Pageable pageable);

    List<SaleEntity> findAllByTenantId(UUID tenantId);

    // --- Dashboard Analytics Queries ---

    @Query("SELECT COUNT(s) FROM SaleEntity s WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end")
    int countByTenantIdAndDateRange(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start,
            @Param("end") LocalDateTime end);

    @Query("SELECT COALESCE(SUM(s.netAmount), 0) FROM SaleEntity s WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end")
    BigDecimal sumNetAmountByTenantIdAndDateRange(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start,
            @Param("end") LocalDateTime end);

    @Query("SELECT COALESCE(SUM(s.netAmount), 0) FROM SaleEntity s WHERE s.tenantId = :tenantId " +
            "AND s.createdAt BETWEEN :start AND :end AND s.branch.id IN :branchIds")
    BigDecimal sumNetAmountByTenantIdAndDateRangeAndBranch(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start,
            @Param("end") LocalDateTime end,
            @Param("branchIds") Collection<UUID> branchIds);

    // --- Add-on (topping) sales ------------------------------------------
    //
    // Every product report filters si.productId IS NOT NULL, which is exactly
    // what keeps add-on rows (V61 children, product_id NULL) out of them. These
    // are the other side: only add-on rows, grouped by the add-on they were.
    // Rows are {toppingId, MAX(itemName), SUM(quantity), SUM(totalAmount)} for
    // sales and {toppingId, SUM(quantityReturned), SUM(refundAmount)} for
    // completed refunds, both keyed on the SALE's date so the two line up.

    @Query("SELECT si.toppingId, MAX(si.itemName), SUM(si.quantity), SUM(si.totalAmount) " +
            "FROM SaleItemEntity si JOIN si.sale s " +
            "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
            "AND si.toppingId IS NOT NULL GROUP BY si.toppingId")
    List<Object[]> aggregateToppingSales(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start, @Param("end") LocalDateTime end);

    @Query("SELECT si.toppingId, MAX(si.itemName), SUM(si.quantity), SUM(si.totalAmount) " +
            "FROM SaleItemEntity si JOIN si.sale s " +
            "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
            "AND si.toppingId IS NOT NULL AND s.branch.id IN :branchIds GROUP BY si.toppingId")
    List<Object[]> aggregateToppingSalesByBranch(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start, @Param("end") LocalDateTime end,
            @Param("branchIds") Collection<UUID> branchIds);

    @Query("SELECT si.toppingId, SUM(ri.quantityReturned), SUM(ri.refundAmount) " +
            "FROM com.lumora.pos.returns.entity.ReturnItemEntity ri JOIN ri.saleItem si JOIN si.sale s " +
            "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
            "AND si.toppingId IS NOT NULL " +
            "AND ri.returnEntity.status = com.lumora.pos.returns.entity.ReturnEntity.ReturnStatus.COMPLETED " +
            "GROUP BY si.toppingId")
    List<Object[]> aggregateToppingRefunds(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start, @Param("end") LocalDateTime end);

    @Query("SELECT si.toppingId, SUM(ri.quantityReturned), SUM(ri.refundAmount) " +
            "FROM com.lumora.pos.returns.entity.ReturnItemEntity ri JOIN ri.saleItem si JOIN si.sale s " +
            "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
            "AND si.toppingId IS NOT NULL AND s.branch.id IN :branchIds " +
            "AND ri.returnEntity.status = com.lumora.pos.returns.entity.ReturnEntity.ReturnStatus.COMPLETED " +
            "GROUP BY si.toppingId")
    List<Object[]> aggregateToppingRefundsByBranch(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start, @Param("end") LocalDateTime end,
            @Param("branchIds") Collection<UUID> branchIds);

    /**
     * Top selling products by quantity in a date range.
     * Returns Object[] = {productId (UUID), SUM(quantity) (BigDecimal),
     * SUM(totalAmount) (BigDecimal)}
     */
    @Query("SELECT si.productId, SUM(si.quantity), SUM(si.totalAmount) " +
            "FROM SaleItemEntity si JOIN si.sale s " +
            "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
            "AND si.productId IS NOT NULL " +
            "GROUP BY si.productId ORDER BY SUM(si.quantity) DESC")
    List<Object[]> findTopSellingProducts(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start,
            @Param("end") LocalDateTime end,
            Pageable pageable);

    /**
     * Payment method breakdown in a date range.
     * Returns Object[] = {paymentMethod (String), COUNT (Long), SUM(netAmount)
     * (BigDecimal)}
     */
    @Query("SELECT s.paymentMethod, COUNT(s), SUM(s.netAmount) " +
            "FROM SaleEntity s " +
            "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
            "GROUP BY s.paymentMethod")
    List<Object[]> findPaymentMethodBreakdown(@Param("tenantId") UUID tenantId,
            @Param("start") LocalDateTime start,
            @Param("end") LocalDateTime end);

    @Query("SELECT s FROM SaleEntity s LEFT JOIN FETCH s.items LEFT JOIN FETCH s.customer " +
            "WHERE s.tenantId = :tenantId ORDER BY s.createdAt DESC")
    List<SaleEntity> findRecentSales(@Param("tenantId") UUID tenantId, Pageable pageable);

    /**
     * All sales rung up during a given cash session, newest first. Backs the
     * terminal's "this shift's sales" correction picker. Items/customer are
     * fetched so the response mapper avoids N+1 lookups.
     */
    @Query("SELECT DISTINCT s FROM SaleEntity s LEFT JOIN FETCH s.items LEFT JOIN FETCH s.customer " +
            "WHERE s.cashSessionId = :sessionId AND s.tenantId = :tenantId ORDER BY s.createdAt DESC")
    List<SaleEntity> findByCashSessionIdAndTenantId(@Param("sessionId") UUID sessionId,
            @Param("tenantId") UUID tenantId);

    // --- Enhanced Reporting Aggregations ---

    @Query(value = "SELECT s.createdBy, COUNT(s), SUM(s.netAmount), AVG(s.netAmount), SUM(s.discountAmount) " +
           "FROM SaleEntity s WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "GROUP BY s.createdBy",
           countQuery = "SELECT COUNT(DISTINCT s.createdBy) FROM SaleEntity s " +
           "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end")
    Page<Object[]> aggregateEmployeePerformance(@Param("tenantId") UUID tenantId,
                                               @Param("start") LocalDateTime start,
                                               @Param("end") LocalDateTime end,
                                               Pageable pageable);

    @Query(value = "SELECT s.createdBy, COUNT(s), SUM(s.netAmount), AVG(s.netAmount), SUM(s.discountAmount) " +
           "FROM SaleEntity s WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "AND s.branch.id IN :branchIds GROUP BY s.createdBy",
           countQuery = "SELECT COUNT(DISTINCT s.createdBy) FROM SaleEntity s " +
           "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end AND s.branch.id IN :branchIds")
    Page<Object[]> aggregateEmployeePerformanceByBranch(@Param("tenantId") UUID tenantId,
                                               @Param("start") LocalDateTime start,
                                               @Param("end") LocalDateTime end,
                                               @Param("branchIds") Collection<UUID> branchIds,
                                               Pageable pageable);

    @Query(value = "SELECT c.id, c.firstName || ' ' || c.lastName, c.email, c.phone, COUNT(s), SUM(s.netAmount), c.loyaltyPoints " +
           "FROM SaleEntity s JOIN s.customer c " +
           "WHERE s.tenantId = :tenantId " +
           "GROUP BY c.id, c.firstName, c.lastName, c.email, c.phone, c.loyaltyPoints",
           countQuery = "SELECT COUNT(DISTINCT c.id) FROM SaleEntity s JOIN s.customer c " +
           "WHERE s.tenantId = :tenantId")
    Page<Object[]> aggregateTopCustomers(@Param("tenantId") UUID tenantId, Pageable pageable);

    @Query("SELECT s.paymentMethod, COUNT(s), SUM(s.taxAmount), SUM(s.totalAmount) " +
           "FROM SaleEntity s WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "GROUP BY s.paymentMethod")
    List<Object[]> aggregateTaxSummary(@Param("tenantId") UUID tenantId,
                                      @Param("start") LocalDateTime start,
                                      @Param("end") LocalDateTime end);

    @Query("SELECT si.productId, SUM(si.quantity), SUM(si.totalAmount) " +
           "FROM SaleItemEntity si JOIN si.sale s " +
           "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "AND si.productId IS NOT NULL " +
           "GROUP BY si.productId")
    List<Object[]> aggregateProductProfitability(@Param("tenantId") UUID tenantId,
                                                @Param("start") LocalDateTime start,
                                                @Param("end") LocalDateTime end);

    @Query("SELECT si.productId, SUM(si.quantity), SUM(si.totalAmount) " +
           "FROM SaleItemEntity si JOIN si.sale s " +
           "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "AND si.productId IS NOT NULL AND s.branch.id IN :branchIds " +
           "GROUP BY si.productId")
    List<Object[]> aggregateProductProfitabilityByBranch(@Param("tenantId") UUID tenantId,
                                                @Param("start") LocalDateTime start,
                                                @Param("end") LocalDateTime end,
                                                @Param("branchIds") Collection<UUID> branchIds);

    @Query(value = "SELECT si.productId, SUM(si.quantity), SUM(si.totalAmount) " +
           "FROM SaleItemEntity si JOIN si.sale s " +
           "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "AND si.productId IS NOT NULL " +
           "GROUP BY si.productId",
           countQuery = "SELECT COUNT(DISTINCT si.productId) FROM SaleItemEntity si JOIN si.sale s " +
           "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "AND si.productId IS NOT NULL")
    Page<Object[]> aggregateProductProfitability(@Param("tenantId") UUID tenantId,
                                                @Param("start") LocalDateTime start,
                                                @Param("end") LocalDateTime end,
                                                Pageable pageable);

    @Query(value = "SELECT si.productId, SUM(si.quantity), SUM(si.totalAmount) " +
           "FROM SaleItemEntity si JOIN si.sale s " +
           "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "AND si.productId IS NOT NULL AND s.branch.id IN :branchIds " +
           "GROUP BY si.productId",
           countQuery = "SELECT COUNT(DISTINCT si.productId) FROM SaleItemEntity si JOIN si.sale s " +
           "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "AND si.productId IS NOT NULL AND s.branch.id IN :branchIds")
    Page<Object[]> aggregateProductProfitabilityByBranch(@Param("tenantId") UUID tenantId,
                                                @Param("start") LocalDateTime start,
                                                @Param("end") LocalDateTime end,
                                                @Param("branchIds") Collection<UUID> branchIds,
                                                Pageable pageable);
    @Query("SELECT s.paymentMethod, COUNT(s), SUM(s.totalAmount), SUM(s.taxAmount), SUM(s.discountAmount), SUM(s.netAmount) " +
           "FROM SaleEntity s " +
           "WHERE s.tenantId = :tenantId AND s.createdAt BETWEEN :start AND :end " +
           "GROUP BY s.paymentMethod")
    List<Object[]> aggregateDailySummary(@Param("tenantId") UUID tenantId,
                                        @Param("start") LocalDateTime start,
                                        @Param("end") LocalDateTime end);

    /**
     * Total cash physically received within a cash session, used at shift close to
     * compute expected drawer balance (opening float + cash received).
     * Uses the cash_tendered column so SPLIT sales contribute their cash portion
     * rather than being ignored by a CASH-only payment_method filter.
     */
    @Query("SELECT COALESCE(SUM(s.cashTendered), 0) FROM SaleEntity s " +
           "WHERE s.cashSessionId = :sessionId")
    BigDecimal sumCashSalesBySessionId(@Param("sessionId") UUID sessionId);
}
