package com.lumora.pos.ingredient.entity;

import com.lumora.pos.common.entity.BaseEntity;
import com.lumora.pos.supplier.entity.SupplierEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/**
 * Something the kitchen buys and the menu does not sell — rice, oil, eggs (V72).
 * Stock lives per branch in {@link IngredientStockLevelEntity}; every change to it
 * is a row in {@link IngredientMovementEntity}.
 *
 * <p>Names are unique per tenant ignoring case ({@code uk_ingredients_tenant_name},
 * a functional index JPA cannot declare, so the service checks it first).
 */
@Entity
@Table(name = "ingredients", indexes = {
        @Index(name = "idx_ing_tenant_active", columnList = "tenant_id, is_active")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IngredientEntity extends BaseEntity {

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private IngredientUnit unit;

    /** Last price paid per unit; a received purchase order overwrites it. */
    @Builder.Default
    @Column(name = "cost_per_unit", nullable = false, precision = 12, scale = 4)
    private BigDecimal costPerUnit = BigDecimal.ZERO;

    /** Alert at or below this quantity; 0 means never alert. */
    @Builder.Default
    @Column(name = "low_stock_threshold", nullable = false, precision = 12, scale = 3)
    private BigDecimal lowStockThreshold = BigDecimal.ZERO;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "primary_supplier_id")
    private SupplierEntity primarySupplier;

    @Builder.Default
    @Column(nullable = false)
    private boolean isActive = true;
}
