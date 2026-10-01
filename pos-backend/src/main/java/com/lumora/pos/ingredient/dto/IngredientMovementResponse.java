package com.lumora.pos.ingredient.dto;

import com.lumora.pos.ingredient.entity.IngredientMovementEntity.MovementType;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Data
@Builder
public class IngredientMovementResponse {
    private UUID id;
    private MovementType type;
    private UUID branchId;
    private String branchName;
    private BigDecimal quantityChange;
    private BigDecimal quantityAfter;
    private BigDecimal unitCost;
    private UUID referenceId;
    private String reason;
    private String createdByName;
    private LocalDateTime createdAt;
}
