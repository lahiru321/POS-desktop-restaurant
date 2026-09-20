package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.ToppingEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ToppingRepository extends JpaRepository<ToppingEntity, UUID> {

    Optional<ToppingEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<ToppingEntity> findAllByGroupIdAndTenantIdOrderBySortOrderAscNameAsc(UUID groupId, UUID tenantId);

    List<ToppingEntity> findAllByGroupIdInAndTenantIdOrderBySortOrderAscNameAsc(
            Collection<UUID> groupIds, UUID tenantId);
}
