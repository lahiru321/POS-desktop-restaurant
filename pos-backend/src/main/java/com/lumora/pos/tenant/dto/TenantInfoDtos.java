package com.lumora.pos.tenant.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.util.UUID;

public class TenantInfoDtos {

    @Data
    @Builder
    public static class TenantInfoResponse {
        private UUID id;
        private String name;
        private String addressLine1;
        private String addressLine2;
        private String phone;
        private String logoUrl;
        private String receiptFooter;
        /** Loyalty program settings (always present — defaults when never configured). */
        private boolean loyaltyEnabled;
        /** Currency spent to earn 1 point (e.g. 10 → 1 pt per LKR 10). */
        private BigDecimal loyaltySpendPerPoint;
        /** Cash value of 1 point when redeemed (e.g. 0.10 → 100 pts = LKR 10). */
        private BigDecimal loyaltyPointValue;
        /** True if shelf prices are VAT-inclusive (tax extracted) vs exclusive
         *  (tax added at the till). Defaults to inclusive (LK retail convention). */
        private boolean taxInclusive;
        /** Covers (seated guests) pre-filled when a new dine-in tab is opened. */
        private Integer defaultCovers;
        /** Service charge on dine-in bills, in percent (10 = 10%). 0 = none. */
        private Integer serviceChargeRate;
        /** A cashier needs a manager PIN to void food the kitchen already has. */
        private boolean restaurantVoidRequiresPin;
    }

    @Data
    @Builder
    public static class LogoUploadResponse {
        private String logoUrl;
    }

    @Data
    public static class TenantInfoUpdateRequest {
        @NotBlank
        @Size(max = 255)
        private String name;

        @Size(max = 255)
        private String addressLine1;

        @Size(max = 255)
        private String addressLine2;

        @Size(max = 50)
        private String phone;

        // Holds a base64 data URI (~1.37× the image size); cap allows a ~512 KB image
        // and bounds abusive direct PUTs.
        @Size(max = 1_000_000)
        private String logoUrl;

        @Size(max = 500)
        private String receiptFooter;

        /** Loyalty settings. Null fields are left unchanged (keeps the existing value). */
        private Boolean loyaltyEnabled;

        @DecimalMin(value = "0", inclusive = false, message = "Spend-per-point must be greater than 0")
        private BigDecimal loyaltySpendPerPoint;

        @DecimalMin(value = "0", message = "Point value must be non-negative")
        private BigDecimal loyaltyPointValue;

        /** Inclusive vs exclusive VAT pricing. Null leaves the existing value unchanged. */
        private Boolean taxInclusive;

        /** Restaurant settings. Null fields are left unchanged (keeps the existing value). */
        @Min(value = 1, message = "Default covers must be at least 1")
        @Max(value = 99, message = "Default covers must be 99 or fewer")
        private Integer defaultCovers;

        @Min(value = 0, message = "Service charge cannot be negative")
        @Max(value = 50, message = "Service charge must be 50% or less")
        private Integer serviceChargeRate;

        /** Null leaves the existing value unchanged. */
        private Boolean restaurantVoidRequiresPin;
    }
}
