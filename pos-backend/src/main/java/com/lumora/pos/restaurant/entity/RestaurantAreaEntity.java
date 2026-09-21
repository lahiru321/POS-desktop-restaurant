package com.lumora.pos.restaurant.entity;

import com.lumora.pos.common.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.*;

/**
 * A named part of the room — "Ground Floor", "Balcony", "Garden".
 *
 * <p>Exists so the floor view can tab between sections instead of showing forty
 * tiles at once. Tenant-scoped, not branch-scoped: this product is one
 * restaurant per install.
 */
@Entity
@Table(name = "restaurant_areas", indexes = {
        @Index(name = "idx_rest_area_tenant", columnList = "tenant_id, sort_order")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RestaurantAreaEntity extends BaseEntity {

    @Column(nullable = false, length = 100)
    private String name;

    @Builder.Default
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 0;

    /**
     * Soft delete. An area that has seated tables keeps its history, so the UI
     * hides it rather than deleting it.
     */
    @Builder.Default
    @Column(name = "is_active", nullable = false)
    private boolean isActive = true;
}
