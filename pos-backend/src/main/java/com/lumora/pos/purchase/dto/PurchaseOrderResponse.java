package com.lumora.pos.purchase.dto;

import com.lumora.pos.purchase.entity.PurchaseOrderEntity.POStatus;
import lombok.Builder;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Data
@Builder
public class PurchaseOrderResponse {
    private UUID id;
    private String poNumber;
    private UUID supplierId;
    private String supplierName;
    private UUID branchId;
    private String branchName;
    private POStatus status;
    private LocalDateTime expectedDate;
    private BigDecimal totalAmount;
    private String notes;
    private UUID createdBy;
    private String createdByName;
    private UUID receivedBy;
    private String receivedByName;
    private List<PurchaseOrderItemResponse> items;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @Data
    @Builder
    public static class PurchaseOrderItemResponse {
        private UUID id;
        /** PRODUCT or INGREDIENT. */
        private String itemType;
        /** The product's or the ingredient's name. */
        private String name;
        /** The ingredient's unit (KG, L, ...); PCS for a product. */
        private String unit;
        private UUID productId;
        private UUID ingredientId;
        private String productName;
        private String sku;
        private BigDecimal orderedQuantity;
        private BigDecimal receivedQuantity;
        private BigDecimal unitCost;
        private BigDecimal totalCost;
    }
}
