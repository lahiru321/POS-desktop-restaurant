package com.lumora.pos.cashsession.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

public class CashSessionDtos {

    @Data
    public static class StartShiftRequest {
        @NotNull
        @PositiveOrZero
        private BigDecimal openingBalance;

        /** Branch to open the drawer at. When null, resolves to the user's primary branch then the tenant default. */
        private UUID branchId;

        private String notes;
    }

    @Data
    public static class EndShiftRequest {
        @NotNull
        @PositiveOrZero
        private BigDecimal closingBalance;

        private String notes;
    }

    @Data
    @Builder
    public static class CashSessionResponse {
        private UUID id;
        private UUID userId;
        private String userName;
        private UUID branchId;
        private String branchName;
        private UUID timeRecordId;
        private LocalDateTime clockInTime;
        private LocalDateTime clockOutTime;
        private BigDecimal openingBalance;
        private BigDecimal closingBalance;
        private BigDecimal expectedBalance;
        private BigDecimal cashSalesTotal;      // sum of cash tendered for all sales in this session
        private BigDecimal cashRefundsTotal;    // sum of CASH refunds issued during this session
        private BigDecimal cashRepaymentsTotal; // sum of CASH store-credit repayments taken in this session
        private BigDecimal variance;            // closingBalance - expectedBalance; positive = over, negative = short
        private String status;
        private LocalDateTime openedAt;
        private LocalDateTime closedAt;
        private String notes;
    }
}
