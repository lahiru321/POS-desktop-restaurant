package com.lumora.pos.ingredient.repository;

import com.lumora.pos.ingredient.entity.IngredientMovementEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.UUID;

@Repository
public interface IngredientMovementRepository extends JpaRepository<IngredientMovementEntity, UUID> {

    @EntityGraph(attributePaths = "branch")
    Page<IngredientMovementEntity> findAllByTenantIdAndIngredientIdOrderByCreatedAtDesc(
            UUID tenantId, UUID ingredientId, Pageable pageable);

    @EntityGraph(attributePaths = "branch")
    Page<IngredientMovementEntity> findAllByTenantIdAndIngredientIdAndBranchIdInOrderByCreatedAtDesc(
            UUID tenantId, UUID ingredientId, Collection<UUID> branchIds, Pageable pageable);
}
