package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.RestaurantAreaEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every method carries tenantId explicitly — there is no automatic tenant
 * scoping in this codebase, despite BaseEntity's javadoc claiming otherwise.
 */
public interface RestaurantAreaRepository extends JpaRepository<RestaurantAreaEntity, UUID> {

    List<RestaurantAreaEntity> findAllByTenantIdOrderBySortOrderAscNameAsc(UUID tenantId);

    Optional<RestaurantAreaEntity> findByIdAndTenantId(UUID id, UUID tenantId);
}
