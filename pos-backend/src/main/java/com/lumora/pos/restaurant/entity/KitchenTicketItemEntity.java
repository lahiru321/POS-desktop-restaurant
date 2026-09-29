package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * One line on a kitchen ticket: the delta for this sheet, never the line's
 * running total. A snapshot — see {@link KitchenTicketEntity}.
 */
@Entity
@Table(name = "kitchen_ticket_items", indexes = {
        @Index(name = "idx_kt_item_ticket", columnList = "ticket_id, course_no, sort_order")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class KitchenTicketItemEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "ticket_id", nullable = false)
    private KitchenTicketEntity ticket;

    /** Plain id, not a relation: the order line may later be removed, and the
     *  column is {@code ON DELETE SET NULL} so the ticket survives it. */
    @Column(name = "order_item_id")
    private UUID orderItemId;

    @Column(name = "item_name", nullable = false)
    private String itemName;

    @Column(nullable = false, precision = 19, scale = 3)
    private BigDecimal quantity;

    /** Add-ons, one per line, exactly as printed. */
    @Column(length = 1000)
    private String modifiers;

    @Column(length = 255)
    private String notes;

    @Builder.Default
    @Column(name = "course_no", nullable = false)
    private int courseNo = 1;

    @Builder.Default
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;
}
