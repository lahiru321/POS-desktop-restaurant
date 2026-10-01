package com.lumora.pos.ingredient.repository;

import com.lumora.pos.ingredient.entity.IngredientStockLevelEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface IngredientStockLevelRepository extends JpaRepository<IngredientStockLevelEntity, UUID> {

    List<IngredientStockLevelEntity> findAllByTenantId(UUID tenantId);

    List<IngredientStockLevelEntity> findAllByTenantIdAndBranchIdIn(UUID tenantId, Collection<UUID> branchIds);

    Optional<IngredientStockLevelEntity> findByIngredientIdAndBranchIdAndTenantId(UUID ingredientId, UUID branchId,
                                                                                UUID tenantId);

    /** The row every stock change goes through, locked so two receipts or counts queue instead of racing. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT sl FROM IngredientStockLevelEntity sl WHERE sl.ingredient.id = :ingredientId " +
           "AND sl.branch.id = :branchId AND sl.tenantId = :tenantId")
    Optional<IngredientStockLevelEntity> findForUpdate(@Param("ingredientId") UUID ingredientId,
                                                       @Param("branchId") UUID branchId,
                                                       @Param("tenantId") UUID tenantId);

    /**
     * Ingredient stock value per branch for Inventory Valuation.
     * Returns Object[] = { branchName, ingredientCount (Long), value (BigDecimal) }.
     */
    @Query("SELECT b.name, COUNT(sl), SUM(sl.quantity * i.costPerUnit) " +
           "FROM IngredientStockLevelEntity sl JOIN sl.ingredient i JOIN sl.branch b " +
           "WHERE sl.tenantId = :tenantId AND sl.quantity > 0 " +
           "GROUP BY b.name ORDER BY b.name")
    List<Object[]> valuationByBranch(@Param("tenantId") UUID tenantId);

    /** {@link #valuationByBranch} limited to the given branches. */
    @Query("SELECT b.name, COUNT(sl), SUM(sl.quantity * i.costPerUnit) " +
           "FROM IngredientStockLevelEntity sl JOIN sl.ingredient i JOIN sl.branch b " +
           "WHERE sl.tenantId = :tenantId AND sl.quantity > 0 AND b.id IN :branchIds " +
           "GROUP BY b.name ORDER BY b.name")
    List<Object[]> valuationByBranchIn(@Param("tenantId") UUID tenantId,
                                       @Param("branchIds") Collection<UUID> branchIds);
}
