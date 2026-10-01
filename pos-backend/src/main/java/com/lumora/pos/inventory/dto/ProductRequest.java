package com.lumora.pos.inventory.dto;

import com.lumora.pos.inventory.service.KitchenStations;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProductRequest {

    @NotBlank(message = "Product name is required")
    private String name;

    private String sku;

    private String barcode;

    private String description;

    @NotNull(message = "Base price is required")
    @PositiveOrZero(message = "Base price must be zero or positive")
    private BigDecimal basePrice;

    @PositiveOrZero(message = "Cost price must be zero or positive")
    private BigDecimal costPrice;

    @NotNull(message = "Initial stock quantity is required")
    @PositiveOrZero(message = "Stock quantity cannot be negative")
    private Integer stockQuantity;

    @NotNull(message = "Low stock threshold is required")
    @PositiveOrZero(message = "Threshold cannot be negative")
    private Integer lowStockThreshold;

    private String imageUrl;

    private UUID categoryId;

    private UUID brandId;

    private UUID primarySupplierId;

    private List<BranchStockRequest> branchStockLevels;

    @Builder.Default
    private boolean isActive = true;

    /**
     * False for made-to-order items: no stock_levels row is created, the sale
     * never deducts, and fractional quantities are allowed (V59).
     *
     * <p>Defaults false: on a restaurant menu most items are cooked to order, and
     * a dish counted in units reads 0 and blocks the till. Bottled drinks and
     * other bought-in items opt in. {@code stockQuantity} stays required either
     * way — send 0 for an untracked product rather than changing the contract.
     */
    @Builder.Default
    private boolean trackStock = false;

    /**
     * Which kitchen printer this dish goes to ({@code BAR}, {@code GRILL}).
     * Blank inherits the category's station, then {@code KITCHEN}. Normalized
     * to upper case on save.
     */
    @Size(max = KitchenStations.MAX_LENGTH, message = "Kitchen station must be 20 characters or fewer")
    @Pattern(regexp = KitchenStations.PATTERN,
            message = "Kitchen station may only contain letters, numbers, spaces, '-' and '_'")
    private String kitchenStation;
}
