package com.lumora.pos.credit.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One append-only entry in a customer's store-credit ledger.
 *
 * <p>The signed {@link #amount} (positive = charged to the account on a credit
 * sale, negative = repaid) plus the {@link #balanceAfter} snapshot make the
 * customer's outstanding-balance history auditable without replaying every sale.
 * The single source of truth for the current balance remains
 * {@code customers.credit_balance}; each ledger row records the value it
 * resulted in. Mirrors {@code LoyaltyTransactionEntity}.
 */
@Entity
@Table(name = "credit_transactions")
@Getter
@Setter
public class CreditTransactionEntity extends BaseEntity {

    @Column(name = "customer_id", nullable = false)
    private UUID customerId;

    /** The credit sale that charged the account. Null for repayments and adjustments. */
    @Column(name = "sale_id")
    private UUID saleId;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", nullable = false, length = 20)
    private Type type;

    /** Signed amount — positive for CHARGE (owes more), negative for REPAYMENT (owes less). */
    @Column(name = "amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    /** Customer's outstanding balance immediately after this entry was applied. */
    @Column(name = "balance_after", nullable = false, precision = 12, scale = 2)
    private BigDecimal balanceAfter;

    /** How a repayment was made (CASH/CARD/ONLINE). Null for charges/adjustments. */
    @Column(name = "payment_method", length = 20)
    private String paymentMethod;

    /** Open drawer a cash repayment fed into, for shift reconciliation. Null otherwise. */
    @Column(name = "cash_session_id")
    private UUID cashSessionId;

    @Column(name = "description", length = 255)
    private String description;

    public enum Type {
        CHARGE, REPAYMENT, ADJUST
    }
}
