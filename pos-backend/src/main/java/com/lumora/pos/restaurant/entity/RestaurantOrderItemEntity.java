package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * One line on an open tab.
 *
 * <p>{@code unitPriceSnapshot} is what the dish cost when it was ordered, not
 * what gets billed: {@code createSale} re-reads {@code products.base_price} at
 * settle and ignores any client figure. The snapshot exists so the settle
 * response can tell the cashier which lines moved, rather than silently charging
 * a number nobody quoted.
 *
 * <p>{@code firedQuantity} and {@code voidedQuantity} are counted separately,
 * not netted: an item can be voided <em>after</em> it was fired, and the kitchen
 * still needs a void ticket for it.
 */
@Entity
@Table(name = "restaurant_order_items", indexes = {
        @Index(name = "idx_rest_oitem_order", columnList = "order_id, course_no, sort_order")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RestaurantOrderItemEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private RestaurantOrderEntity order;

    /** Null for a custom/open line, as sale_items has allowed since V49. */
    @Column(name = "product_id")
    private UUID productId;

    /** Snapshot, so a renamed or deleted product still reads correctly. */
    @Column(name = "item_name", nullable = false)
    private String itemName;

    @Column(nullable = false, precision = 19, scale = 3)
    private BigDecimal quantity;

    /** Already sent to the kitchen. {@code quantity - firedQuantity} is the next round. */
    @Builder.Default
    @Column(name = "fired_quantity", nullable = false, precision = 19, scale = 3)
    private BigDecimal firedQuantity = BigDecimal.ZERO;

    @Builder.Default
    @Column(name = "voided_quantity", nullable = false, precision = 19, scale = 3)
    private BigDecimal voidedQuantity = BigDecimal.ZERO;

    @Column(name = "unit_price_snapshot", nullable = false, precision = 12, scale = 2)
    private BigDecimal unitPriceSnapshot;

    @Builder.Default
    @Column(name = "discount_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal discountAmount = BigDecimal.ZERO;

    /** "no chilli", "well done" — carried to the kitchen and onto the bill. */
    @Column(length = 255)
    private String notes;

    @Builder.Default
    @Column(name = "course_no", nullable = false)
    private int courseNo = 1;

    @Builder.Default
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @Builder.Default
    @OneToMany(mappedBy = "orderItem", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("sortOrder ASC")
    private List<RestaurantOrderItemToppingEntity> toppings = new ArrayList<>();

    /** What is still on the bill: ordered less voided. */
    public BigDecimal billableQuantity() {
        return quantity.subtract(voidedQuantity);
    }

    public void addTopping(RestaurantOrderItemToppingEntity topping) {
        topping.setOrderItem(this);
        topping.setTenantId(getTenantId());
        toppings.add(topping);
    }
}
