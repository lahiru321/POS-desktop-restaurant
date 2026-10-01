package com.lumora.pos.purchase.entity;

import com.lumora.pos.common.entity.BaseEntity;
import com.lumora.pos.ingredient.entity.IngredientEntity;
import com.lumora.pos.inventory.entity.ProductEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

@Entity
@Table(name = "purchase_order_items", indexes = {
        @Index(name = "idx_poi_po", columnList = "purchase_order_id"),
        @Index(name = "idx_poi_product", columnList = "product_id"),
        @Index(name = "idx_poi_ingredient", columnList = "ingredient_id")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
/**
 * One line of a purchase order: exactly one of {@code product} (a stock-tracked menu
 * item, whole quantities) or {@code ingredient} (any quantity to 3 places) — V73's
 * {@code chk_poi_product_or_ingredient}.
 */
public class PurchaseOrderItemEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "purchase_order_id", nullable = false)
    private PurchaseOrderEntity purchaseOrder;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "product_id")
    private ProductEntity product;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ingredient_id")
    private IngredientEntity ingredient;

    @Column(nullable = false, precision = 12, scale = 3)
    private BigDecimal orderedQuantity;

    @Builder.Default
    @Column(nullable = false, precision = 12, scale = 3)
    private BigDecimal receivedQuantity = BigDecimal.ZERO;

    /** Four places: an ingredient can be priced per gram. */
    @Column(nullable = false, precision = 15, scale = 4)
    private BigDecimal unitCost;

    @Column(nullable = false, precision = 15, scale = 2)
    private BigDecimal totalCost;

    public boolean isIngredientLine() {
        return ingredient != null;
    }

    public String getItemName() {
        return isIngredientLine() ? ingredient.getName() : product.getName();
    }
}
