package com.lumora.pos.purchase.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReceivePoItemRequest {

    @NotNull(message = "Purchase Order Item ID is required")
    private java.util.UUID poItemId;

    @NotNull(message = "Received quantity is required")
    @DecimalMin(value = "0", message = "Received quantity cannot be negative")
    private java.math.BigDecimal receivedQuantity;
}
