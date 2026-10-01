package com.lumora.pos.ingredient.dto;

import com.lumora.pos.ingredient.entity.IngredientUnit;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.UUID;

/** Create or full-replace an ingredient. Active/inactive is its own endpoint. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IngredientRequest {

    @NotBlank(message = "Ingredient name is required")
    @Size(max = 255, message = "Name is too long")
    private String name;

    @NotNull(message = "Unit is required")
    private IngredientUnit unit;

    /** Null = 0. */
    @DecimalMin(value = "0", message = "Cost per unit cannot be negative")
    private BigDecimal costPerUnit;

    /** Null = 0 = never alert. */
    @DecimalMin(value = "0", message = "Low-stock alert cannot be negative")
    private BigDecimal lowStockThreshold;

    private UUID primarySupplierId;
}
