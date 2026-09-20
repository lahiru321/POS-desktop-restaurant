package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

import java.math.BigDecimal;

/**
 * One priced answer within a {@link ToppingGroupEntity} — "Extra cheese",
 * "Onions", "Special sauce".
 *
 * <p>{@link PriceMode} is the security-relevant field. {@code FIXED} means the
 * server always bills {@link #defaultPrice} and discards whatever price the
 * client sent, which is the same rule catalogue products live under.
 * {@code PROMPT} is an explicit, per-topping opt-in to "the cashier types this
 * at order time", bounded by {@link #maxPrice}.
 *
 * <p>A client cannot set either field, which is what keeps the exemption narrow.
 */
@Entity
@Table(name = "toppings", indexes = {
        @Index(name = "idx_topping_tenant_group", columnList = "tenant_id, group_id, sort_order")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ToppingEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private ToppingGroupEntity group;

    @Column(nullable = false, length = 100)
    private String name;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(name = "price_mode", nullable = false, length = 20)
    private PriceMode priceMode = PriceMode.FIXED;

    @Builder.Default
    @Column(name = "default_price", nullable = false, precision = 12, scale = 2)
    private BigDecimal defaultPrice = BigDecimal.ZERO;

    /** {@link PriceMode#PROMPT} only. Null = uncapped. */
    @Column(name = "max_price", precision = 12, scale = 2)
    private BigDecimal maxPrice;

    @Builder.Default
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @Builder.Default
    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;

    public enum PriceMode {
        /** Server bills {@code defaultPrice}; the request's price is discarded. */
        FIXED,
        /** Cashier types the price at order time; clamped to {@code maxPrice}. */
        PROMPT
    }
}
