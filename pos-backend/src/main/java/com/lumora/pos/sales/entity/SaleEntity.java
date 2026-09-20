package com.lumora.pos.sales.entity;

import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.common.entity.BaseEntity;
import com.lumora.pos.customer.entity.CustomerEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.hibernate.annotations.Where;

@Entity
@Table(name = "sales")
@Getter
@Setter
@Where(clause = "is_deleted = false")
public class SaleEntity extends BaseEntity {

    @Column(name = "is_deleted", nullable = false)
    private boolean isDeleted = false;

    @Column(name = "invoice_number", nullable = false)
    private String invoiceNumber;

    @Column(name = "total_amount", nullable = false)
    private BigDecimal totalAmount;

    @Column(name = "tax_amount", nullable = false)
    private BigDecimal taxAmount;

    @Column(name = "discount_amount", nullable = false)
    private BigDecimal discountAmount;

    @Column(name = "net_amount", nullable = false)
    private BigDecimal netAmount;

    /** True if this sale's prices were VAT-inclusive (tax extracted from the
     *  price) rather than exclusive (tax added on top). Captured per sale so a
     *  reprinted invoice's supply-value/VAT breakdown stays faithful even if the
     *  tenant later changes its pricing mode. {@code taxAmount} is the VAT either
     *  way; {@code netAmount} is always the amount the customer paid. */
    @Column(name = "tax_inclusive", nullable = false)
    private boolean taxInclusive = false;

    /** Cash physically received. CASH sales: equals netAmount. SPLIT: the cash
     *  portion entered at checkout. CARD/ONLINE/CREDIT: 0. Used by the drawer
     *  variance query so it correctly accounts for mixed-tender transactions. */
    @Column(name = "cash_tendered", nullable = false)
    private BigDecimal cashTendered = BigDecimal.ZERO;

    /** Gross cash the customer actually handed over (before change). For CASH this
     *  may exceed netAmount — the difference is the change given back. Kept purely
     *  for the receipt's Cash/Change lines and reprints; it does NOT feed drawer
     *  variance (cashTendered does). Null for CARD/ONLINE/CREDIT and legacy rows. */
    @Column(name = "amount_tendered")
    private BigDecimal amountTendered;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_status", nullable = false)
    private PaymentStatus paymentStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_method", nullable = false)
    private PaymentMethod paymentMethod;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "customer_id")
    private CustomerEntity customer;

    // Branch the sale was rung up at. Nullable for legacy rows created before
    // V35 — return-stock restoration falls back to the default branch in that
    // case (with a logged warning).
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "branch_id")
    private BranchEntity branch;

    @Column(name = "cash_session_id")
    private UUID cashSessionId;

    /** Loyalty points the customer spent on this sale (0 when none redeemed). */
    @Column(name = "loyalty_points_redeemed", nullable = false)
    private int loyaltyPointsRedeemed = 0;

    /** Bill reduction those redeemed points bought (post-tax). 0 when none redeemed. */
    @Column(name = "loyalty_discount_amount", nullable = false)
    private BigDecimal loyaltyDiscountAmount = BigDecimal.ZERO;

    // Ordered so a topping always follows the dish it belongs to. Without an
    // explicit @OrderBy, Postgres gives no ordering guarantee and a receipt's
    // add-on lines can drift away from their parent.
    @OneToMany(mappedBy = "sale", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder ASC")
    private List<SaleItemEntity> items = new ArrayList<>();

    public enum PaymentStatus {
        PENDING, PAID, PARTIAL, REFUNDED, CANCELLED
    }

    public enum PaymentMethod {
        CASH, CARD, ONLINE, SPLIT, CREDIT
    }
}
