package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

/**
 * A further table an open tab occupies: the party pushed T1 and T2 together.
 *
 * <p>The tab's own table stays {@link RestaurantOrderEntity#getTable()}; these
 * are the extras. A row lives only while its tab is OPEN — settle, void and
 * merge delete it — so V71 can hold {@code table_id} UNIQUE outright.
 */
@Entity
@Table(name = "restaurant_order_tables", indexes = {
        @Index(name = "idx_rot_tenant_order", columnList = "tenant_id, order_id")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RestaurantOrderTableEntity extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private RestaurantOrderEntity order;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "table_id", nullable = false)
    private RestaurantTableEntity table;
}
