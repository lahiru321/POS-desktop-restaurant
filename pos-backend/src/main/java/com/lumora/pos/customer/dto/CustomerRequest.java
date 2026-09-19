package com.lumora.pos.customer.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.math.BigDecimal;

@Data
public class CustomerRequest {
    @NotBlank(message = "First name is required")
    private String firstName;
    private String lastName;
    private String phone;
    private String email;
    private String address;

    /** Store-credit limit set by an admin/manager. Null leaves the existing limit unchanged. */
    @DecimalMin(value = "0", message = "creditLimit must be non-negative")
    private BigDecimal creditLimit;
}
