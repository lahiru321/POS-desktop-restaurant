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

        /**
         * A manager's PIN, when the tenant requires one to void food the kitchen
         * already has and the person voiding is not a manager. Never stored.
         */
        @Size(max = 12)
        private String managerPin;
    }

    /**
     * Pay for part of a tab now. The chosen quantities leave the tab as an order
     * of their own and are settled on the spot; the rest stays open.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SplitSettleRequest {
        @NotEmpty(message = "Pick what is being paid for")
        @Valid
        private List<SplitLine> lines;

        @NotBlank(message = "Payment method is required")
        private String paymentMethod;

        @DecimalMin(value = "0", message = "cashTendered must be non-negative")
        private BigDecimal cashTendered;

        @Min(value = 0, message = "pointsToRedeem must be non-negative")
        private Integer pointsToRedeem;

        /** The cashier took the service charge off this part of the bill. */
        private Boolean waiveServiceCharge;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class SplitLine {
        @NotNull(message = "itemId is required")
        private UUID itemId;

        @NotNull(message = "quantity is required")
        @DecimalMin(value = "0", inclusive = false, message = "quantity must be positive")
        private BigDecimal quantity;
    }

    /** Carry a tab to another, free table. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MoveOrderRequest {
        @NotNull(message = "Pick the table to move to")
        private UUID tableId;
    }

    /** Fold another open tab into this one. */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class MergeOrderRequest {
        @NotNull(message = "Pick the tab to merge in")
        private UUID sourceOrderId;
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

        /** The cashier took the service charge off this bill. Dine-in only; recorded on the sale. */
        private Boolean waiveServiceCharge;
    }

    /**
     * A takeaway paid at the counter: the order, the payment and the kitchen
     * ticket in one call and one transaction. If the payment is refused — out of
     * stock, wrong drawer — nothing is left behind: no orphan OPEN order, no
     * burned order number, no ticket for food nobody paid for.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class TakeawayRequest {
        @NotEmpty(message = "Add at least one item")
        @Valid
        private List<OrderItemRequest> items;

        private UUID customerId;

        /** Falls back to the user's primary branch, then the tenant default. */
        private UUID branchId;

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
        /** Set when this order was paid out of another tab. */
        private UUID splitFromId;
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
        /** Not yet sent to the kitchen. */
        private BigDecimal pendingQuantity;
        private BigDecimal unitPriceSnapshot;
        private BigDecimal discountAmount;
        private String notes;
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

    /**
     * An order change that may have produced paper for the kitchen: a fire, or a
     * void of something the kitchen already had.
     *
     * <p>The tickets are already persisted {@code PENDING} when this returns. The
     * till prints each one and acknowledges it; until it does, the ticket counts
     * as unresolved. {@code tickets} is empty when nothing needed telling — a void
     * of an item that was never sent, for example.
     */
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class OrderKitchenResponse {
        private OrderResponse order;
        private List<KitchenTicketDtos.KitchenTicketResponse> tickets;
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
        /**
         * Kitchen tickets fired by the settle — a takeaway pays, then fires, so
         * anything it has not yet sent goes to the kitchen now. Always empty for
         * dine-in, whose rounds were sent while the guests were eating. Saved
         * PENDING; the till prints and acknowledges them.
         */
        private List<KitchenTicketDtos.KitchenTicketResponse> tickets;
    }
}
