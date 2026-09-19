package com.lumora.pos.inventory.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProductResponse {

    private UUID id;
    private String name;
    private String sku;
    private String barcode;
    private String description;
    private BigDecimal basePrice;
    private BigDecimal costPrice;
    private Integer stockQuantity;
    private Integer lowStockThreshold;
    private String imageUrl;
    // Explicit JSON name — Jackson would otherwise serialize this as "active"
    // (it strips the "is" prefix from boolean getters), which doesn't match the
    // frontend's Product.isActive contract.
    @JsonProperty("isActive")
    private boolean isActive;

    // No @JsonProperty needed: Lombok's getter is isTrackStock(), and stripping
    // the "is" prefix yields "trackStock" — already the name the frontend wants.
    private boolean trackStock;

    private UUID categoryId;
    private String categoryName;

    private UUID brandId;
    private String brandName;

    private UUID primarySupplierId;
    private String primarySupplierName;

    private List<StockLevelResponse> stockLevels;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
