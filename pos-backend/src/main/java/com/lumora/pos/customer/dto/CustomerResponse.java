package com.lumora.pos.customer.dto;

import lombok.Builder;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Data
@Builder
public class CustomerResponse {
    private UUID id;
    private String firstName;
    private String lastName;
    private String phone;
    private String email;
    private String address;
    private Integer loyaltyPoints;
    /** Admin-set store-credit limit (0 = no credit allowed). */
    private BigDecimal creditLimit;
    /** Current outstanding credit balance (amount owed); read-only. */
    private BigDecimal creditBalance;
    private LocalDateTime createdAt;
}
