package com.lumora.pos.inventory.repository;

import com.lumora.pos.inventory.entity.CategoryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CategoryRepository extends JpaRepository<CategoryEntity, UUID> {

    List<CategoryEntity> findAllByTenantId(UUID tenantId);

    /** Every station a category names, for the till's station → printer settings. */
    @Query("SELECT DISTINCT c.kitchenStation FROM CategoryEntity c WHERE c.tenantId = :tenantId AND c.kitchenStation IS NOT NULL")
    List<String> findDistinctKitchenStations(@Param("tenantId") UUID tenantId);

    Optional<CategoryEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    List<CategoryEntity> findAllByTenantIdAndParentIsNull(UUID tenantId);

    @Query("SELECT c FROM CategoryEntity c WHERE c.tenantId = :tenantId AND LOWER(c.name) LIKE LOWER(CONCAT('%', :search, '%'))")
    List<CategoryEntity> searchByName(@Param("tenantId") UUID tenantId, @Param("search") String search);

    Optional<CategoryEntity> findByNameAndTenantId(String name, UUID tenantId);
}
