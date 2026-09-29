package com.lumora.pos.returns.entity;

import com.lumora.pos.common.entity.BaseEntity;
import com.lumora.pos.sales.entity.SaleItemEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "return_items")
@Getter
@Setter
public class ReturnItemEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "return_id", nullable = false)
    private ReturnEntity returnEntity;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "sale_item_id", nullable = false)
    private SaleItemEntity saleItem;

    /** Null for an add-on or a custom line — see V66. */
    @Column(name = "product_id")
    private UUID productId;

    @Column(name = "quantity_returned", nullable = false, precision = 10, scale = 2)
    private BigDecimal quantityReturned;

    @Column(name = "unit_price", nullable = false, precision = 12, scale = 2)
    private BigDecimal unitPrice;

    @Column(name = "refund_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal refundAmount;
}
