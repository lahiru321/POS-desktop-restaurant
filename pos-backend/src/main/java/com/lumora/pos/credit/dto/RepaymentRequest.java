package com.lumora.pos.credit.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

import java.math.BigDecimal;

@Data
public class RepaymentRequest {

    @NotNull(message = "amount is required")
    @DecimalMin(value = "0", inclusive = false, message = "amount must be positive")
    private BigDecimal amount;

    /** How the customer paid the credit back. CASH feeds the open cash drawer. */
    @NotNull(message = "paymentMethod is required")
    @Pattern(regexp = "CASH|CARD|ONLINE", message = "paymentMethod must be CASH, CARD or ONLINE")
    private String paymentMethod;

    private String description;
}
