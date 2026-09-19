package com.lumora.pos.credit.repository;

import com.lumora.pos.credit.entity.CreditTransactionEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

public interface CreditTransactionRepository extends JpaRepository<CreditTransactionEntity, UUID> {

    Page<CreditTransactionEntity> findByCustomerIdAndTenantIdOrderByCreatedAtDesc(
            UUID customerId, UUID tenantId, Pageable pageable);

    /**
     * Total cash physically taken in as credit repayments during a drawer session.
     * REPAYMENT amounts are stored negative, so negate the sum to get the positive
     * cash-in. Returns null when the session had no cash repayments.
     */
    @Query("SELECT -SUM(t.amount) FROM CreditTransactionEntity t "
            + "WHERE t.cashSessionId = :sessionId "
            + "AND t.type = com.lumora.pos.credit.entity.CreditTransactionEntity.Type.REPAYMENT "
            + "AND t.paymentMethod = 'CASH'")
    BigDecimal sumCashRepaymentsBySessionId(@Param("sessionId") UUID sessionId);

    /** Most recent repayment timestamp for a customer, or null if they've never repaid. */
    @Query("SELECT MAX(t.createdAt) FROM CreditTransactionEntity t "
            + "WHERE t.customerId = :customerId AND t.tenantId = :tenantId "
            + "AND t.type = com.lumora.pos.credit.entity.CreditTransactionEntity.Type.REPAYMENT")
    LocalDateTime findLastRepaymentAt(@Param("customerId") UUID customerId, @Param("tenantId") UUID tenantId);
}
