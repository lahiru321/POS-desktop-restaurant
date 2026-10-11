package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.RestaurantVoidEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface RestaurantVoidRepository extends JpaRepository<RestaurantVoidEntity, UUID> {

    List<RestaurantVoidEntity> findAllByTenantIdAndVoidedAtBetweenOrderByVoidedAtDesc(
            UUID tenantId, LocalDateTime start, LocalDateTime end);

    List<RestaurantVoidEntity> findAllByTenantIdAndBranchIdInAndVoidedAtBetweenOrderByVoidedAtDesc(
            UUID tenantId, Collection<UUID> branchIds, LocalDateTime start, LocalDateTime end);
}
