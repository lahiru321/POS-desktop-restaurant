package com.lumora.pos.restaurant.entity;

import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * An open tab: rounds accumulated over an hour, settled once at the end.
 *
 * <p>Deliberately not a DRAFT {@code SaleEntity}. {@code SaleService.createSale}
 * stamps {@code cashSessionId} from the <em>creating</em> user's drawer, so a tab
 * opened by one server and paid to another would land on the wrong drawer and
 * corrupt the Z-report. Settling calls {@code createSale} unmodified at the
 * moment of payment, which puts the sale on the <em>paying</em> cashier.
 */
@Entity
@Table(name = "restaurant_orders", indexes = {
        @Index(name = "idx_rest_order_tenant_status", columnList = "tenant_id, status, opened_at DESC")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RestaurantOrderEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "branch_id", nullable = false)
    private BranchEntity branch;

    /** Allocated per (tenant, branch, business date). What staff shout: "order 14". */
    @Column(name = "order_number", nullable = false)
    private int orderNumber;

    /** Store calendar day in Asia/Colombo, not the server's UTC date. */
    @Column(name = "business_date", nullable = false)
    private LocalDate businessDate;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "order_type", nullable = false, length = 20)
    private OrderType orderType = OrderType.DINE_IN;

    /** Null for takeaway. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "table_id")
    private RestaurantTableEntity table;

    @Column(name = "customer_id")
    private UUID customerId;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private OrderStatus status = OrderStatus.OPEN;

    /** Guests at the table. 0 = not recorded. */
    @Builder.Default
    @Column(nullable = false)
    private int covers = 0;

    @Column(name = "opened_by")
    private UUID openedBy;

    @Column(name = "served_by")
    private UUID servedBy;

    /** Set at settle: the link from this tab to the money it became. */
    @Column(name = "sale_id")
    private UUID saleId;

    /** Times fired to the kitchen. Labels rounds without counting tickets. */
    @Builder.Default
    @Column(name = "round_count", nullable = false)
    private int roundCount = 0;

    @Column(name = "opened_at", nullable = false)
    private LocalDateTime openedAt;

    @Column(name = "settled_at")
    private LocalDateTime settledAt;

    @Builder.Default
    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("courseNo ASC, sortOrder ASC")
    private List<RestaurantOrderItemEntity> items = new ArrayList<>();

    public void addItem(RestaurantOrderItemEntity item) {
        item.setOrder(this);
        item.setTenantId(getTenantId());
        items.add(item);
    }

    public enum OrderType {
        DINE_IN,
        TAKEAWAY
    }

    public enum OrderStatus {
        /** Accumulating rounds. At most one per table — enforced by a partial index. */
        OPEN,
        /** Paid. {@code saleId} points at the sale it became. */
        SETTLED,
        /** Abandoned without payment. */
        VOIDED
    }
}
