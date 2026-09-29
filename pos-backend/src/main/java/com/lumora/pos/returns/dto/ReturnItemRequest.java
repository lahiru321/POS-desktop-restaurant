package com.lumora.pos.returns.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReturnItemRequest {
    @NotNull(message = "Sale item ID is required")
    private UUID saleItemId;

    /**
     * Ignored — the product is read from the sale line itself. Optional because
     * an add-on or a custom line has none, and requiring it made those lines
     * impossible to refund.
     */
    private UUID productId;

    @NotNull(message = "Quantity to return is required")
    @Positive(message = "Quantity must be positive")
    private BigDecimal quantity;
}
