package com.lumora.pos.purchase.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PurchaseOrderRequest {

    @NotNull(message = "Supplier ID is required")
    private UUID supplierId;

    @NotNull(message = "Branch ID is required")
    private UUID branchId;

    private LocalDateTime expectedDate;

    private String notes;

    @NotEmpty(message = "At least one item is required in the purchase order")
    @Valid
    private List<PurchaseOrderItemRequest> items;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class PurchaseOrderItemRequest {
        /** A stock-tracked menu item. Exactly one of productId / ingredientId. */
        private UUID productId;

        private UUID ingredientId;

        /** Whole for a product; up to 3 places for an ingredient (2.5 kg). */
        @NotNull(message = "Quantity is required")
        @DecimalMin(value = "0", inclusive = false, message = "Quantity must be more than zero")
        private BigDecimal quantity;

        @NotNull(message = "Unit cost is required")
        @DecimalMin(value = "0", message = "Unit cost cannot be negative")
        private BigDecimal unitCost;
    }
}
