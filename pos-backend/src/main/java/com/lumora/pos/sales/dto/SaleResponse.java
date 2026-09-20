package com.lumora.pos.sales.dto;

import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Data
@Builder
public class SaleResponse {
    private UUID id;
    private String invoiceNumber;
    private BigDecimal totalAmount;
    private BigDecimal taxAmount;
    private BigDecimal discountAmount;
    private BigDecimal netAmount;
    private String paymentStatus;
    private String paymentMethod;
    /** Gross cash the customer handed over (CASH/SPLIT). Null for card/online. */
    private BigDecimal amountTendered;
    /** Change given back = amountTendered − netAmount, floored at 0. */
    private BigDecimal changeDue;
    private LocalDateTime createdAt;
    private String cashierName;
    private UUID customerId;
    private String customerName;
    private Integer earnedPoints;
    private Integer loyaltyBalance;
    /** Points the customer spent on this sale (0 when none). */
    private Integer pointsRedeemed;
    /** Bill reduction the redeemed points bought (post-tax). */
    private BigDecimal loyaltyDiscountAmount;
    /** True if prices were VAT-inclusive (taxAmount was extracted from netAmount)
     *  rather than added on top. Drives the receipt's VAT breakdown. */
    private boolean taxInclusive;
    private List<SaleItemResponse> items;

    @Data
    @Builder
    public static class SaleItemResponse {
        private UUID id;
        private UUID productId;
        private String productName;
        private BigDecimal quantity;
        private BigDecimal unitPrice;
        private BigDecimal discountAmount;
        private BigDecimal taxAmount;
        private BigDecimal totalAmount;

        /** The dish this add-on modifies; null for a top-level line. */
        private UUID parentItemId;

        /**
         * Set when this line is an add-on. Both a topping and a custom/open line
         * have a null productId, so this is what tells the receipt which it is.
         */
        private UUID toppingId;

        /** Preserves cashier order, so a topping renders under its dish. */
        private Integer sortOrder;

        /** "no chilli" — shown on the bill beneath the line. */
        private String notes;
    }
}
