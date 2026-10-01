package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.RestaurantOrderTableEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/**
 * Every method carries tenantId explicitly — there is no automatic tenant
 * scoping in this codebase, despite BaseEntity's javadoc claiming otherwise.
 */
public interface RestaurantOrderTableRepository extends JpaRepository<RestaurantOrderTableEntity, UUID> {

    /** The tab a table is joined to, if any. V71 keeps it to at most one. */
    @Query("""
            SELECT j FROM RestaurantOrderTableEntity j JOIN FETCH j.order
            WHERE j.tenantId = :tenantId AND j.table.id = :tableId
            """)
    Optional<RestaurantOrderTableEntity> findByTableId(
            @Param("tenantId") UUID tenantId, @Param("tableId") UUID tableId);
}
