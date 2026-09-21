package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.RestaurantOrderEntity;
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
public interface RestaurantOrderRepository extends JpaRepository<RestaurantOrderEntity, UUID> {

    Optional<RestaurantOrderEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<RestaurantOrderEntity> findAllByTenantIdAndStatusOrderByOpenedAtDesc(
            UUID tenantId, RestaurantOrderEntity.OrderStatus status);

    /**
     * Row lock for settle and void.
     *
     * <p>Two cashiers pressing "settle" on the same tab a second apart would
     * otherwise both read status = OPEN and both call createSale, billing the
     * table twice. The lock makes the second wait and then see SETTLED.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM RestaurantOrderEntity o WHERE o.id = :id AND o.tenantId = :tenantId")
    Optional<RestaurantOrderEntity> findByIdAndTenantIdForUpdate(
            @Param("id") UUID id, @Param("tenantId") UUID tenantId);

    /**
     * The open tab on a table, if any. The database's partial unique index
     * guarantees there is at most one.
     */
    @Query("""
            SELECT o FROM RestaurantOrderEntity o
            WHERE o.tenantId = :tenantId AND o.table.id = :tableId AND o.status = 'OPEN'
            """)
    Optional<RestaurantOrderEntity> findOpenByTableId(
            @Param("tenantId") UUID tenantId, @Param("tableId") UUID tableId);
}
