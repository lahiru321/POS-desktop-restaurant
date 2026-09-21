package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.RestaurantTableEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every method carries tenantId explicitly — there is no automatic tenant
 * scoping in this codebase, despite BaseEntity's javadoc claiming otherwise.
 */
public interface RestaurantTableRepository extends JpaRepository<RestaurantTableEntity, UUID> {

    List<RestaurantTableEntity> findAllByTenantIdOrderBySortOrderAscNameAsc(UUID tenantId);

    List<RestaurantTableEntity> findAllByTenantIdAndAreaIdOrderBySortOrderAscNameAsc(UUID tenantId, UUID areaId);

    Optional<RestaurantTableEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    /**
     * Guards the friendly duplicate-name message. The database's
     * {@code uk_rest_table_area_name} is the backstop; this check is
     * case-insensitive where the index is not, because "t1" and "T1" in one area
     * is a mis-click rather than a floor plan.
     */
    boolean existsByTenantIdAndAreaIdAndNameIgnoreCase(UUID tenantId, UUID areaId, String name);

    boolean existsByTenantIdAndAreaId(UUID tenantId, UUID areaId);

    long countByTenantIdAndAreaId(UUID tenantId, UUID areaId);
}
