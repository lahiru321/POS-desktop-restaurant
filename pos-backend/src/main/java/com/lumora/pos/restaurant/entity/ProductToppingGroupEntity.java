package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import com.lumora.pos.inventory.entity.ProductEntity;
import jakarta.persistence.*;
import lombok.*;

/**
 * Attaches a {@link ToppingGroupEntity} to a product, so the till knows which
 * questions to ask when that dish is tapped.
 *
 * <p>A join entity rather than a column on either side: a group applies to many
 * products, and a product offers many groups.
 */
@Entity
@Table(name = "product_topping_groups",
        uniqueConstraints = {
                @UniqueConstraint(name = "uk_ptg_product_group", columnNames = { "product_id", "group_id" })
        },
        indexes = {
                @Index(name = "idx_ptg_tenant_product", columnList = "tenant_id, product_id, sort_order")
        })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProductToppingGroupEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "product_id", nullable = false)
    private ProductEntity product;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private ToppingGroupEntity group;

    @Builder.Default
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;
}
