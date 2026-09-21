package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * An add-on chosen on an order line while the tab is open.
 *
 * <p>These become child {@code sale_items} rows (via {@code parent_item_id}) at
 * settle — not the same rows, because a tab is not a sale until it is paid for.
 *
 * <p>{@code toppingName} is a snapshot, so renaming "Extra cheese" never
 * rewrites a tab a customer is already eating. {@code priceMode} rides along so
 * settle can re-derive the price the way ring-up did: FIXED re-reads the
 * definition, PROMPT honours the typed figure.
 */
@Entity
@Table(name = "restaurant_order_item_toppings", indexes = {
        @Index(name = "idx_rest_oitop_item", columnList = "order_item_id, sort_order")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RestaurantOrderItemToppingEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_item_id", nullable = false)
    private RestaurantOrderItemEntity orderItem;

    /** Null once the topping has been deleted from the menu (ON DELETE SET NULL). */
    @Column(name = "topping_id")
    private UUID toppingId;

    @Column(name = "topping_name", nullable = false, length = 100)
    private String toppingName;

    @Builder.Default
    @Column(nullable = false, precision = 19, scale = 3)
    private BigDecimal quantity = BigDecimal.ONE;

    @Builder.Default
    @Column(name = "unit_price", nullable = false, precision = 12, scale = 2)
    private BigDecimal unitPrice = BigDecimal.ZERO;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "price_mode", nullable = false, length = 20)
    private ToppingEntity.PriceMode priceMode = ToppingEntity.PriceMode.FIXED;

    @Builder.Default
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;
}
