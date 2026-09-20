package com.lumora.pos.restaurant.dto;

import com.lumora.pos.restaurant.entity.ToppingEntity;
import com.lumora.pos.restaurant.entity.ToppingGroupEntity;
import jakarta.validation.constraints.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Request/response shapes for topping groups and toppings.
 *
 * <p>Grouped in one file because they are small, always used together, and the
 * alternative is eight near-empty classes.
 */
public final class ToppingDtos {

    private ToppingDtos() {
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GroupRequest {
        @NotBlank(message = "Group name is required")
        @Size(max = 100)
        private String name;

        /** SINGLE or MULTI. Defaults to MULTI when omitted. */
        private ToppingGroupEntity.SelectionMode selectionMode;

        @PositiveOrZero(message = "Minimum selections cannot be negative")
        private Integer minSelect;

        @Positive(message = "Maximum selections must be at least 1")
        private Integer maxSelect;

        private Integer sortOrder;

        @Builder.Default
        private boolean isActive = true;

        /**
         * A group whose minimum exceeds its maximum can never be satisfied, so the
         * till would refuse to add the dish at all.
         */
        @AssertTrue(message = "Minimum selections cannot exceed the maximum")
        public boolean isSelectionRangeCoherent() {
            if (minSelect == null || maxSelect == null) {
                return true;
            }
            return minSelect <= maxSelect;
        }
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ToppingUpsertRequest {
        @NotNull(message = "Group is required")
        private UUID groupId;

        @NotBlank(message = "Topping name is required")
        @Size(max = 100)
        private String name;

        /** FIXED or PROMPT. Defaults to FIXED when omitted. */
        private ToppingEntity.PriceMode priceMode;

        @NotNull(message = "Default price is required")
        @PositiveOrZero(message = "Default price cannot be negative")
        private BigDecimal defaultPrice;

        /** PROMPT only; null means uncapped. */
        @PositiveOrZero(message = "Maximum price cannot be negative")
        private BigDecimal maxPrice;

        private Integer sortOrder;

        @Builder.Default
        private boolean isActive = true;

        /**
         * A ceiling below the suggested price would reject the cashier's very first
         * keystroke, so it is refused at configuration time rather than at the till.
         */
        @AssertTrue(message = "Maximum price cannot be below the default price")
        public boolean isPriceRangeCoherent() {
            if (maxPrice == null || defaultPrice == null) {
                return true;
            }
            return maxPrice.compareTo(defaultPrice) >= 0;
        }
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ToppingResponse {
        private UUID id;
        private UUID groupId;
        private String name;
        private ToppingEntity.PriceMode priceMode;
        private BigDecimal defaultPrice;
        private BigDecimal maxPrice;
        private Integer sortOrder;
        private boolean isActive;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class GroupResponse {
        private UUID id;
        private String name;
        private ToppingGroupEntity.SelectionMode selectionMode;
        private Integer minSelect;
        private Integer maxSelect;
        private Integer sortOrder;
        private boolean isActive;
        /** Populated on reads; the till needs the answers with the question. */
        private List<ToppingResponse> toppings;
    }
}
