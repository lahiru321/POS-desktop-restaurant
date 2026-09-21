package com.lumora.pos.restaurant.dto;

import com.lumora.pos.restaurant.entity.RestaurantOrderEntity;
import com.lumora.pos.restaurant.entity.ToppingEntity;
import com.lumora.pos.sales.dto.SaleResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Request/response shapes for open tabs.
 *
 * <p>No request sets a price for a catalogue line: the order snapshots
 * {@code products.base_price} at ring-up and {@code createSale} re-reads it at
 * settle. A typed price is accepted only where the retail terminal already
 * accepts one — a custom/open line, and a topping whose server-side
 * {@code price_mode} is PROMPT.
 */
public final class OrderDtos {

    private OrderDtos() {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OpenOrderRequest {
        /** DINE_IN (default) or TAKEAWAY. */
        private RestaurantOrderEntity.OrderType orderType;

        /** Required for DINE_IN, rejected for TAKEAWAY. */
        private UUID tableId;

        private UUID customerId;

        /** Falls back to the user's primary branch, then the tenant default. */
        private UUID branchId;

        @PositiveOrZero(message = "Covers cannot be negative")
        private Integer covers;

        /** The server looking after this table. Defaults to whoever opened it. */
        private UUID servedBy;

        /** Optional opening round, so seating and the first order are one call. */
        @Valid
        private List<OrderItemRequest> items;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AddItemsRequest {
        @NotEmpty(message = "Add at least one item")
        @Valid
        private List<OrderItemRequest> items;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrderItemRequest {
        /** Catalogue product. Null for a custom/open line (then itemName is required). */
        private UUID productId;

        /** Typed name for a custom/open line. Ignored when productId is set. */
        @Size(max = 255)
        private String itemName;

        @NotNull(message = "quantity is required")
        @DecimalMin(value = "0", inclusive = false, message = "quantity must be positive")
        private BigDecimal quantity;

        /** Honoured only for a custom/open line; a catalogue line is priced server-side. */
        @DecimalMin(value = "0", message = "unitPrice must be non-negative")
        private BigDecimal unitPrice;

        @DecimalMin(value = "0", message = "discountAmount must be non-negative")
        private BigDecimal discountAmount;

        @Size(max = 255)
        private String notes;

        /** Starters 1, mains 2, dessert 3. Defaults to 1. */
        @Positive(message = "courseNo starts at 1")
        private Integer courseNo;

        @Valid
        private List<OrderItemToppingRequest> toppings;

        @AssertTrue(message = "Each line must have a productId or a custom itemName")
        public boolean isProductOrName() {
            return productId != null || (itemName != null && !itemName.isBlank());
        }
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrderItemToppingRequest {
        @NotNull(message = "toppingId is required")
        private UUID toppingId;

        /** Per parent unit. Defaults to 1 — "double cheese" is quantity 2. */
        @DecimalMin(value = "0", inclusive = false, message = "topping quantity must be positive")
        private BigDecimal quantity;

        /** Consulted only for a PROMPT topping; discarded for a FIXED one. */
        @DecimalMin(value = "0", message = "topping unitPrice must be non-negative")
        private BigDecimal unitPrice;
    }

    /** Edits that do not remove anything. Removing quantity is a void. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UpdateItemRequest {
        @DecimalMin(value = "0", inclusive = false, message = "quantity must be positive")
        private BigDecimal quantity;

        @Size(max = 255)
        private String notes;

        @Positive(message = "courseNo starts at 1")
        private Integer courseNo;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class VoidItemRequest {
        /** How much to void. Omitted = the whole remaining line. */
        @DecimalMin(value = "0", inclusive = false, message = "quantity must be positive")
        private BigDecimal quantity;

        @Size(max = 255)
        private String reason;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SettleRequest {
        @NotBlank(message = "Payment method is required")
        private String paymentMethod;

        @DecimalMin(value = "0", message = "cashTendered must be non-negative")
        private BigDecimal cashTendered;

        @Min(value = 0, message = "pointsToRedeem must be non-negative")
        private Integer pointsToRedeem;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrderResponse {
        private UUID id;
        private int orderNumber;
        /** "Order 14 · T1" — what staff say out loud. */
        private String label;
        private LocalDate businessDate;
        private RestaurantOrderEntity.OrderType orderType;
        private RestaurantOrderEntity.OrderStatus status;
        private UUID branchId;
        private UUID tableId;
        private String tableName;
        private UUID customerId;
        private int covers;
        private UUID openedBy;
        private UUID servedBy;
        private UUID saleId;
        private int roundCount;
        private LocalDateTime openedAt;
        private LocalDateTime settledAt;
        /** Ordered less voided, priced at the snapshots. Indicative, not the bill. */
        private BigDecimal runningTotal;
        private List<OrderItemResponse> items;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrderItemResponse {
        private UUID id;
        private UUID productId;
        private String itemName;
        private BigDecimal quantity;
        private BigDecimal firedQuantity;
        private BigDecimal voidedQuantity;
        private BigDecimal billableQuantity;
        private BigDecimal unitPriceSnapshot;
        private BigDecimal discountAmount;
        private String notes;
        private int courseNo;
        private int sortOrder;
        private List<OrderItemToppingResponse> toppings;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrderItemToppingResponse {
        private UUID id;
        private UUID toppingId;
        private String toppingName;
        private BigDecimal quantity;
        private BigDecimal unitPrice;
        private ToppingEntity.PriceMode priceMode;
    }

    /**
     * A line whose menu price moved between ordering and paying.
     *
     * <p>createSale re-reads the catalogue, which is correct and must not be
     * weakened — so the cashier is shown the difference and confirms it rather
     * than discovering it on the customer's bill. A FIXED add-on is re-read the
     * same way and reported the same way.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class RepricedLine {
        /** The dish. When {@link #toppingName} is set, this is the line it hangs off. */
        private String itemName;

        /** Set only when it was a FIXED add-on that moved, not the dish itself. */
        private String toppingName;

        private BigDecimal orderedPrice;
        private BigDecimal billedPrice;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SettleResponse {
        private SaleResponse sale;
        private String label;
        /** Empty when nothing re-priced, which is the normal case. */
        private List<RepricedLine> repricedLines;
    }
}
