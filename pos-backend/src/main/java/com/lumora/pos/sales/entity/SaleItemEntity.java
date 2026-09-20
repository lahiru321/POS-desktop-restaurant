package com.lumora.pos.sales.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "sale_items")
@Getter
@Setter
public class SaleItemEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "sale_id", nullable = false)
    private SaleEntity sale;

    /** Null for custom/open lines (item not in the catalog). */
    @Column(name = "product_id")
    private UUID productId;

    /** Typed name for custom/open lines; null for catalog products. */
    @Column(name = "item_name")
    private String itemName;

    @Column(name = "quantity", nullable = false)
    private BigDecimal quantity;

    @Column(name = "unit_price", nullable = false)
    private BigDecimal unitPrice;

    @Column(name = "tax_amount", nullable = false)
    private BigDecimal taxAmount;

    @Column(name = "discount_amount", nullable = false)
    private BigDecimal discountAmount;

    @Column(name = "total_amount", nullable = false)
    private BigDecimal totalAmount;

    /**
     * The dish this add-on line modifies; null for a top-level line (V61).
     *
     * <p>The DB foreign key is {@code DEFERRABLE INITIALLY DEFERRED} because
     * parent and child are both elements of the same cascaded
     * {@link SaleEntity#getItems()} collection, and Hibernate gives no guarantee
     * about insert ordering within a single entity type.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_item_id")
    private SaleItemEntity parentItem;

    /**
     * The topping definition this line came from; null for anything else.
     *
     * <p>Both a topping line and a V49 custom line carry a null
     * {@link #productId}, so this is what tells them apart on a receipt, in a
     * return, or in an audit record.
     */
    @Column(name = "topping_id")
    private UUID toppingId;

    /**
     * Preserves the cashier's line order. The {@code @OneToMany} on
     * {@link SaleEntity} orders by this, so a topping always prints directly
     * beneath its dish.
     */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    /** Free text carried to the kitchen and onto the bill: "no chilli". */
    @Column(name = "notes")
    private String notes;
}
