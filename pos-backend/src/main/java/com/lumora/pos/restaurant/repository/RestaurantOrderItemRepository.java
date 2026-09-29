package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.RestaurantOrderEntity;
import com.lumora.pos.restaurant.entity.RestaurantOrderItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

/**
 * Every method carries tenantId explicitly — there is no automatic tenant
 * scoping in this codebase, despite BaseEntity's javadoc claiming otherwise.
 */
public interface RestaurantOrderItemRepository extends JpaRepository<RestaurantOrderItemEntity, UUID> {

    /**
     * Re-parents every line of one order onto another, in place.
     *
     * <p>A bulk update, deliberately, rather than moving entities between the two
     * {@code items} collections: that collection is {@code orphanRemoval = true},
     * so taking a line out of the source order would <em>delete</em> it, fired
     * quantities and all. The rows keep their ids, their toppings and their fired
     * and voided counts, so the kitchen is never asked to cook them twice.
     *
     * <p>Flushes first and clears after, so pending changes reach the database
     * before the update and no stale collection survives it. Callers re-read.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE RestaurantOrderItemEntity i SET i.order = :target
            WHERE i.order = :source AND i.tenantId = :tenantId
            """)
    int reassignLines(@Param("source") RestaurantOrderEntity source,
                      @Param("target") RestaurantOrderEntity target,
                      @Param("tenantId") UUID tenantId);
}
