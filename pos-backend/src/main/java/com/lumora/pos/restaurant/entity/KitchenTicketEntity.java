package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import com.lumora.pos.inventory.service.KitchenStations;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * One sheet of paper handed to the kitchen.
 *
 * <p>Written {@code PENDING} before the till prints it and moved to
 * {@code PRINTED} or {@code FAILED} by the till's acknowledgement. A ticket still
 * {@code PENDING} after the print should have finished is treated exactly like a
 * failure: the kitchen may never have got it.
 *
 * <p>Everything on it — header and lines — is a snapshot, so a reprint
 * reproduces the original sheet even after the tab has moved on.
 */
@Entity
@Table(name = "kitchen_tickets", indexes = {
        @Index(name = "idx_kt_tenant_status", columnList = "tenant_id, status, created_at"),
        @Index(name = "idx_kt_tenant_order", columnList = "tenant_id, order_id, round_no")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class KitchenTicketEntity extends BaseEntity {

    /** Where a dish goes when neither it nor its category names a station. */
    public static final String DEFAULT_STATION = KitchenStations.DEFAULT;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private RestaurantOrderEntity order;

    @Enumerated(EnumType.STRING)
    @Column(name = "ticket_type", nullable = false, length = 20)
    private TicketType ticketType;

    @Column(name = "round_no", nullable = false)
    private int roundNo;

    /** "#0042-R2" / "#0042-R3-VOID", as printed. */
    @Column(nullable = false, length = 40)
    private String label;

    @Builder.Default
    @Column(nullable = false, length = 20)
    private String station = DEFAULT_STATION;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TicketStatus status = TicketStatus.PENDING;

    @Column(name = "order_number", nullable = false)
    private int orderNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "order_type", nullable = false, length = 20)
    private RestaurantOrderEntity.OrderType orderType;

    @Column(name = "table_name", length = 50)
    private String tableName;

    @Builder.Default
    @Column(nullable = false)
    private int covers = 0;

    @Column(name = "server_name", length = 100)
    private String serverName;

    @Builder.Default
    @Column(name = "print_attempts", nullable = false)
    private int printAttempts = 0;

    @Column(name = "last_error", length = 500)
    private String lastError;

    @Column(name = "printed_at")
    private LocalDateTime printedAt;

    /** MOVE tickets only: the one line the runner needs ("MOVED FROM T4"). */
    @Column(length = 255)
    private String notice;

    @Builder.Default
    @OneToMany(mappedBy = "ticket", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("courseNo ASC, sortOrder ASC")
    private List<KitchenTicketItemEntity> items = new ArrayList<>();

    public void addItem(KitchenTicketItemEntity item) {
        item.setTicket(this);
        item.setTenantId(getTenantId());
        items.add(item);
    }

    public enum TicketType {
        /** New work for the kitchen: everything not yet fired. */
        ROUND,
        /** Stop cooking these — the already-fired portion of a void. */
        VOID,
        /** No lines: the food already sent now goes to a different table. */
        MOVE
    }

    public enum TicketStatus {
        /** Recorded, not yet confirmed printed. Counts as unresolved. */
        PENDING,
        /** The till confirmed the print, or a person took responsibility for it. */
        PRINTED,
        /** The till reported a printer error. Unresolved until retried or handled. */
        FAILED
    }
}
