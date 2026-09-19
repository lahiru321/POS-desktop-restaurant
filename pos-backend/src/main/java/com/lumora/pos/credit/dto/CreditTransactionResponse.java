package com.lumora.pos.credit.dto;

import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Data
@Builder
public class CreditTransactionResponse {
    private UUID id;
    /** CHARGE, REPAYMENT or ADJUST. */
    private String type;
    /** Signed amount (positive charged, negative repaid). */
    private BigDecimal amount;
    /** Outstanding balance after this entry. */
    private BigDecimal balanceAfter;
    /** Repayments only: CASH/CARD/ONLINE. */
    private String paymentMethod;
    private String description;
    private UUID saleId;
    private LocalDateTime createdAt;
}
