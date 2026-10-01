package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.RestaurantTableEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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
     * Row lock for seating, joining and moving onto a table.
     *
     * <p>"Is anyone on T2?" spans two places — a tab's own table and V71's join
     * rows — and no single constraint covers both. Taking the table's lock first
     * makes the three operations queue on it, and under READ COMMITTED each
     * check after the lock sees whatever the one before it committed.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM RestaurantTableEntity t WHERE t.id = :id AND t.tenantId = :tenantId")
    Optional<RestaurantTableEntity> findByIdAndTenantIdForUpdate(
            @Param("id") UUID id, @Param("tenantId") UUID tenantId);

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
