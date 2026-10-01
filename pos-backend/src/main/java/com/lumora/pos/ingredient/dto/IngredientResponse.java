package com.lumora.pos.ingredient.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.lumora.pos.ingredient.entity.IngredientUnit;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Data
@Builder
public class IngredientResponse {
    private UUID id;
    private String name;
    private IngredientUnit unit;
    private BigDecimal costPerUnit;
    private BigDecimal lowStockThreshold;
    private UUID primarySupplierId;
    private String primarySupplierName;
    @JsonProperty("isActive")
    private boolean isActive;
    /** On hand at the requested branch, or across the caller's branches when none was given. */
    private BigDecimal quantity;
    /** quantity x costPerUnit, to the cent. */
    private BigDecimal stockValue;
    /** Alerting is on (threshold above 0) and quantity is at or below it. */
    @JsonProperty("isLowStock")
    private boolean isLowStock;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
