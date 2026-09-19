package com.lumora.pos.inventory.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

@Entity
@Table(name = "products", indexes = {
                @Index(name = "idx_products_tenant", columnList = "tenant_id"),
                @Index(name = "idx_products_category", columnList = "category_id"),
                @Index(name = "idx_products_sku", columnList = "sku")
}, uniqueConstraints = {
                @UniqueConstraint(name = "uk_products_sku_tenant", columnNames = { "sku", "tenant_id" })
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProductEntity extends BaseEntity {

        @Column(nullable = false)
        private String name;

        private String sku;

        private String barcode;

        @Column(columnDefinition = "TEXT")
        private String description;

        @Column(nullable = false)
        private BigDecimal basePrice;

        private BigDecimal costPrice;

        @org.hibernate.annotations.Formula("(SELECT COALESCE(SUM(sl.quantity), 0) FROM stock_levels sl WHERE sl.product_id = id)")
        private Integer stockQuantity;

        @Column(nullable = false)
        private Integer lowStockThreshold;

        private String imageUrl;

        @Builder.Default
        @Column(nullable = false)
        private boolean isActive = true;

        /**
         * Whether selling this product draws down a stock_levels row (V59).
         *
         * <p>False for made-to-order items — a dish is cooked from ingredients, not
         * drawn from a unit count, so it needs no stock row, can never be short, and
         * may be sold in fractional quantities. True for anything counted in units.
         *
         * <p>Defaults true so existing products, and anything created without an
         * explicit choice, keep deducting exactly as before.
         *
         * <p>Note: {@link #stockQuantity} is a {@code @Formula} over stock_levels and
         * therefore reports 0 for an untracked product. Branch on this flag, never on
         * that number.
         */
        @Builder.Default
        @Column(name = "track_stock", nullable = false)
        private boolean trackStock = true;

        @ManyToOne(fetch = FetchType.LAZY)
        @JoinColumn(name = "category_id")
        private CategoryEntity category;

        @ManyToOne(fetch = FetchType.LAZY)
        @JoinColumn(name = "brand_id")
        private BrandEntity brand;

        @ManyToOne(fetch = FetchType.LAZY)
        @JoinColumn(name = "primary_supplier_id")
        private com.lumora.pos.supplier.entity.SupplierEntity primarySupplier;
}
