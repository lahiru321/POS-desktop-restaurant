package com.lumora.pos.inventory.entity;

import com.lumora.pos.common.entity.BaseEntity;
import com.lumora.pos.tax.entity.TaxRateEntity;
import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "categories", indexes = {
        @Index(name = "idx_categories_tenant", columnList = "tenant_id"),
        @Index(name = "idx_categories_parent", columnList = "parent_id")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CategoryEntity extends BaseEntity {

    @Column(nullable = false)
    private String name;

    private String slug;

    @Column(columnDefinition = "TEXT")
    private String description;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    private CategoryEntity parent;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tax_rate_id")
    private TaxRateEntity taxRate;

    /** Default kitchen printer for this category's dishes. Null = {@code KITCHEN}. */
    @Column(name = "kitchen_station", length = 20)
    private String kitchenStation;
}
