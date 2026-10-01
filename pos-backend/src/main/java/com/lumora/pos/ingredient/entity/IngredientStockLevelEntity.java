package com.lumora.pos.ingredient.entity;

import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/** Quantity of one ingredient on hand at one branch. Never negative (DB CHECK). */
@Entity
@Table(name = "ingredient_stock_levels", indexes = {
        @Index(name = "idx_ingsl_tenant_branch", columnList = "tenant_id, branch_id")
}, uniqueConstraints = {
        @UniqueConstraint(name = "uk_ing_stock_ingredient_branch", columnNames = { "ingredient_id", "branch_id" })
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IngredientStockLevelEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ingredient_id", nullable = false)
    private IngredientEntity ingredient;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "branch_id", nullable = false)
    private BranchEntity branch;

    @Builder.Default
    @Column(nullable = false, precision = 12, scale = 3)
    private BigDecimal quantity = BigDecimal.ZERO;
}
