package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.ToppingGroupEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every method carries tenantId explicitly — there is no automatic tenant
 * scoping in this codebase, despite BaseEntity's javadoc claiming otherwise.
 */
public interface ToppingGroupRepository extends JpaRepository<ToppingGroupEntity, UUID> {

    List<ToppingGroupEntity> findAllByTenantIdOrderBySortOrderAscNameAsc(UUID tenantId);

    Optional<ToppingGroupEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    boolean existsByIdAndTenantId(UUID id, UUID tenantId);
}
