package com.lumora.pos.customer.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

@Entity
@Table(name = "customers")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CustomerEntity extends BaseEntity {

    @Column(nullable = false)
    private String firstName;

    private String lastName;

    private String phone;

    private String email;

    @Column(columnDefinition = "TEXT")
    private String address;

    @Builder.Default
    private Integer loyaltyPoints = 0;

    /** Admin-set maximum the customer may owe on store credit. 0 = no credit allowed. */
    @Column(name = "credit_limit", nullable = false, precision = 12, scale = 2)
    @Builder.Default
    private BigDecimal creditLimit = BigDecimal.ZERO;

    /** Current outstanding store-credit balance (amount owed). Kept in sync with the credit ledger. */
    @Column(name = "credit_balance", nullable = false, precision = 12, scale = 2)
    @Builder.Default
    private BigDecimal creditBalance = BigDecimal.ZERO;
}
