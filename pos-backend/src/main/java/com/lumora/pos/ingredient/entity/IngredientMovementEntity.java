package com.lumora.pos.ingredient.entity;

import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;
import java.util.UUID;

/** One change to an ingredient's stock at a branch. Append-only. */
@Entity
@Table(name = "ingredient_movements", indexes = {
        @Index(name = "idx_ingm_tenant_ingredient_created", columnList = "tenant_id, ingredient_id, created_at")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IngredientMovementEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ingredient_id", nullable = false)
    private IngredientEntity ingredient;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "branch_id", nullable = false)
    private BranchEntity branch;

    @Enumerated(EnumType.STRING)
    @Column(name = "movement_type", nullable = false, length = 20)
    private MovementType movementType;

    /** Signed: positive adds stock, negative removes it. */
    @Column(name = "quantity_change", nullable = false, precision = 12, scale = 3)
    private BigDecimal quantityChange;

    @Column(name = "quantity_after", nullable = false, precision = 12, scale = 3)
    private BigDecimal quantityAfter;

    @Column(name = "unit_cost", precision = 12, scale = 4)
    private BigDecimal unitCost;

    /** The purchase order behind a PURCHASE; null otherwise. */
    @Column(name = "reference_id")
    private UUID referenceId;

    private String reason;

    public enum MovementType {
        /** A purchase order line was received. */
        PURCHASE,
        /** Spoiled, dropped or thrown away. */
        WASTAGE,
        /** Stock take: the counted quantity replaced the system's; the change is the difference. */
        COUNT,
        /** Manual signed correction. */
        ADJUST
    }
}
