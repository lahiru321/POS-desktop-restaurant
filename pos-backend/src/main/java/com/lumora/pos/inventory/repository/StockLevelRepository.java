package com.lumora.pos.inventory.repository;

import com.lumora.pos.inventory.entity.StockLevelEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface StockLevelRepository extends JpaRepository<StockLevelEntity, UUID> {

    List<StockLevelEntity> findAllByTenantId(UUID tenantId);

    List<StockLevelEntity> findAllByProductIdAndTenantId(UUID productId, UUID tenantId);
 
    List<StockLevelEntity> findAllByProductIdInAndTenantId(java.util.Collection<UUID> productIds, UUID tenantId);

    List<StockLevelEntity> findAllByBranchIdAndTenantId(UUID branchId, UUID tenantId);

    Optional<StockLevelEntity> findByProductIdAndBranchIdAndTenantId(UUID productId, UUID branchId, UUID tenantId);

    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT sl FROM StockLevelEntity sl WHERE sl.product.id = :productId AND sl.branch.id = :branchId AND sl.tenantId = :tenantId")
    Optional<StockLevelEntity> findByProductAndBranchForUpdate(@Param("productId") UUID productId, @Param("branchId") UUID branchId, @Param("tenantId") UUID tenantId);

    @Query(value = "SELECT sl FROM StockLevelEntity sl JOIN FETCH sl.product p JOIN FETCH sl.branch b WHERE sl.tenantId = :tenantId AND p.isActive = true AND p.trackStock = true AND sl.quantity <= p.lowStockThreshold AND (:branchId IS NULL OR b.id = :branchId)", countQuery = "SELECT count(sl) FROM StockLevelEntity sl JOIN sl.product p JOIN sl.branch b WHERE sl.tenantId = :tenantId AND p.isActive = true AND p.trackStock = true AND sl.quantity <= p.lowStockThreshold AND (:branchId IS NULL OR b.id = :branchId)")
    Page<StockLevelEntity> findLowStockByBranch(@Param("tenantId") UUID tenantId, @Param("branchId") UUID branchId,
            Pageable pageable);
}
