package com.lumora.pos.credit.dto;

import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * A customer's current credit position: their admin-set limit, what they
 * currently owe, and the headroom left to spend on credit.
 */
@Data
@Builder
public class CreditSummaryResponse {
    private UUID customerId;
    private BigDecimal creditLimit;
    private BigDecimal creditBalance;
    private BigDecimal availableCredit;
}
