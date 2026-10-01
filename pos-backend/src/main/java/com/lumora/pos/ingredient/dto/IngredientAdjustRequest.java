package com.lumora.pos.ingredient.dto;

import com.lumora.pos.ingredient.entity.IngredientMovementEntity.MovementType;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * A manual stock change at one branch. What {@code quantity} means depends on the type:
 * <ul>
 *   <li>WASTAGE — how much was thrown away (positive; it comes off the stock).</li>
 *   <li>COUNT — what is physically there now (zero or more; the difference is recorded).</li>
 *   <li>ADJUST — a signed correction.</li>
 * </ul>
 * PURCHASE is not accepted: stock arrives by receiving a purchase order.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IngredientAdjustRequest {

    @NotNull(message = "Branch is required")
    private UUID branchId;

    @NotNull(message = "Type is required")
    private MovementType type;

    @NotNull(message = "Quantity is required")
    private BigDecimal quantity;

    @Size(max = 255, message = "Reason is too long")
    private String reason;
}
