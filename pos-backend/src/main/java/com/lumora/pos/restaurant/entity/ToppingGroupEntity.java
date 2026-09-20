package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

/**
 * A question the cashier is asked about a dish — "Cheese?", "Extras", "Sauce" —
 * holding the {@link ToppingEntity} answers.
 *
 * <p>Authored once and attached to many products through
 * {@link ProductToppingGroupEntity}, so a menu-wide "Extras" list is edited in
 * one place rather than per dish.
 */
@Entity
@Table(name = "topping_groups", indexes = {
        @Index(name = "idx_tgrp_tenant", columnList = "tenant_id, sort_order")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ToppingGroupEntity extends BaseEntity {

    @Column(nullable = false, length = 100)
    private String name;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "selection_mode", nullable = false, length = 20)
    private SelectionMode selectionMode = SelectionMode.MULTI;

    /** Minimum answers before the line can be added. 0 = entirely optional. */
    @Builder.Default
    @Column(name = "min_select", nullable = false)
    private int minSelect = 0;

    /** Null = no ceiling. */
    @Column(name = "max_select")
    private Integer maxSelect;

    @Builder.Default
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @Builder.Default
    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;

    public enum SelectionMode {
        /** Pick at most one — rendered as radios. */
        SINGLE,
        /** Pick any number — rendered as checkboxes. */
        MULTI
    }
}
