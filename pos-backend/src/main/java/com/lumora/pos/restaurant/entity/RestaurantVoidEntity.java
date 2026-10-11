package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Food that came off a tab, kept for the owner's void report (V74). Append-only:
 * written by {@code RestaurantOrderService} in the same transaction as the void,
 * never updated. {@code amount} is the menu value (price + add-ons, before any
 * line discount) and {@code firedQuantity} the part the kitchen had already been
 * told to cook.
 */
@Entity
@Table(name = "restaurant_voids", indexes = {
        @Index(name = "idx_rv_tenant_voided_at", columnList = "tenant_id, voided_at")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RestaurantVoidEntity extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(name = "order_id", nullable = false)
    private UUID orderId;

    @Column(name = "order_item_id", nullable = false)
    private UUID orderItemId;

    @Column(name = "item_name", nullable = false)
    private String itemName;

    @Column(nullable = false, precision = 19, scale = 3)
    private BigDecimal quantity;

    @Builder.Default
    @Column(name = "fired_quantity", nullable = false, precision = 19, scale = 3)
    private BigDecimal firedQuantity = BigDecimal.ZERO;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(name = "whole_tab", nullable = false)
    private boolean wholeTab;

    @Column(length = 255)
    private String reason;

    @Column(name = "voided_by")
    private UUID voidedBy;

    @Column(name = "approved_by")
    private UUID approvedBy;

    @Column(name = "voided_at", nullable = false)
    private LocalDateTime voidedAt;
}
