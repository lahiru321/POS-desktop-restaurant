package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

/**
 * A table on the floor, belonging to exactly one {@link RestaurantAreaEntity}.
 *
 * <p>{@code status} is a denormalised read for the floor grid, never the source
 * of truth. The real invariant — one table, at most one open tab — is the
 * partial unique index on {@code restaurant_orders(table_id) WHERE status =
 * 'OPEN'}. Status exists so painting fifty tiles is one query instead of fifty,
 * and it is owned by the order lifecycle: seating sets OCCUPIED, settling or
 * voiding sets AVAILABLE. No client may set it directly.
 */
@Entity
@Table(name = "restaurant_tables", indexes = {
        @Index(name = "idx_rest_table_tenant_area", columnList = "tenant_id, area_id, sort_order")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RestaurantTableEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "area_id", nullable = false)
    private RestaurantAreaEntity area;

    /**
     * What the staff call it: "T1", "12", "Window 3". Short on purpose — it is
     * printed on kitchen tickets and read across a room.
     */
    @Column(nullable = false, length = 50)
    private String name;

    /**
     * Covers the table normally seats. A hint for the floor view and the default
     * covers on a new tab, never a limit that blocks seating.
     */
    @Builder.Default
    @Column(nullable = false)
    private int seats = 2;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TableStatus status = TableStatus.AVAILABLE;

    @Builder.Default
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    @Builder.Default
    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;

    public enum TableStatus {
        /** No open tab. Free to seat. */
        AVAILABLE,
        /** An open order is running on this table. */
        OCCUPIED
    }
}
