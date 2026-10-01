package com.lumora.pos.ingredient.repository;

import com.lumora.pos.ingredient.entity.IngredientEntity;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface IngredientRepository extends JpaRepository<IngredientEntity, UUID> {

    @EntityGraph(attributePaths = "primarySupplier")
    List<IngredientEntity> findAllByTenantIdOrderByNameAsc(UUID tenantId);

    Optional<IngredientEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    boolean existsByTenantIdAndNameIgnoreCase(UUID tenantId, String name);

    boolean existsByTenantIdAndNameIgnoreCaseAndIdNot(UUID tenantId, String name, UUID id);
}
