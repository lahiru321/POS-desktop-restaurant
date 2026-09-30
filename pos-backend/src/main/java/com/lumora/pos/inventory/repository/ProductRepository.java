package com.lumora.pos.inventory.repository;

import com.lumora.pos.inventory.entity.ProductEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ProductRepository extends JpaRepository<ProductEntity, UUID>, JpaSpecificationExecutor<ProductEntity> {

    Page<ProductEntity> findAllByTenantId(UUID tenantId, Pageable pageable);

    /** Every station a product names, for the till's station → printer settings. */
    @Query("SELECT DISTINCT p.kitchenStation FROM ProductEntity p WHERE p.tenantId = :tenantId AND p.kitchenStation IS NOT NULL")
    List<String> findDistinctKitchenStations(@Param("tenantId") UUID tenantId);

    List<ProductEntity> findAllByTenantId(UUID tenantId);

    Optional<ProductEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    Optional<ProductEntity> findBySkuAndTenantId(String sku, UUID tenantId);

    Optional<ProductEntity> findByBarcodeAndTenantId(String barcode, UUID tenantId);

    List<ProductEntity> findAllByIdInAndTenantId(Collection<UUID> ids, UUID tenantId);

    boolean existsBySkuAndTenantId(String sku, UUID tenantId);

    /**
     * Count products linked to a specific category (for deletion guard).
     */
    long countByCategoryIdAndTenantId(UUID categoryId, UUID tenantId);

    /**
     * Count products linked to a specific brand (for deletion guard).
     */
    long countByBrandIdAndTenantId(UUID brandId, UUID tenantId);

    // --- Dashboard Analytics Queries ---

    /**
     * Products where current stock is at or below the low stock threshold.
     */
    @Query("SELECT p FROM ProductEntity p WHERE p.tenantId = :tenantId AND p.isActive = true AND p.stockQuantity <= p.lowStockThreshold ORDER BY p.stockQuantity ASC")
    List<ProductEntity> findLowStockProducts(@Param("tenantId") UUID tenantId, Pageable pageable);

    /**
     * Count active products for a tenant.
     */
    @Query("SELECT COUNT(p) FROM ProductEntity p WHERE p.tenantId = :tenantId AND p.isActive = true")
    int countActiveByTenantId(@Param("tenantId") UUID tenantId);

    /**
     * Count all products for a tenant.
     */
    long countByTenantId(UUID tenantId);

    /**
     * Aggregated valuation data by category.
     * Returns Object[] = { categoryName (String), productCount (Long), totalStock
     * (Long), totalCost (BigDecimal), totalRetail (BigDecimal) }
     */
    @Query("SELECT COALESCE(c.name, 'Uncategorized'), COUNT(p), SUM(p.stockQuantity), " +
            "SUM(p.stockQuantity * p.costPrice), " +
            "SUM(p.stockQuantity * p.basePrice) " +
            "FROM ProductEntity p " +
            "LEFT JOIN p.category c " +
            "WHERE p.tenantId = :tenantId " +
            "GROUP BY c.name")
    List<Object[]> getInventoryValuationByCategory(@Param("tenantId") UUID tenantId);

    /**
     * Branch-scoped valuation: same shape as {@link #getInventoryValuationByCategory} but
     * driven by per-branch {@code StockLevelEntity} quantities (filtered to the given branches)
     * rather than the company-wide {@code product.stockQuantity}.
     * Returns Object[] = { categoryName, productCount, totalStock, totalCost, totalRetail }.
     */
    @Query("SELECT COALESCE(c.name, 'Uncategorized'), COUNT(DISTINCT p.id), SUM(sl.quantity), " +
            "SUM(sl.quantity * p.costPrice), " +
            "SUM(sl.quantity * p.basePrice) " +
            "FROM StockLevelEntity sl JOIN sl.product p " +
            "LEFT JOIN p.category c " +
            "WHERE sl.tenantId = :tenantId AND sl.branch.id IN :branchIds " +
            "GROUP BY c.name")
    List<Object[]> getInventoryValuationByCategoryAndBranch(@Param("tenantId") UUID tenantId,
            @Param("branchIds") java.util.Collection<UUID> branchIds);

    /**
     * Integrity check: Returns [ID, Name, GlobalStock, SumOfBranchStock]
     */
    @Query("SELECT p.id, p.name, p.stockQuantity, " +
            "(SELECT SUM(sl.quantity) FROM StockLevelEntity sl WHERE sl.product.id = p.id AND sl.tenantId = p.tenantId) "
            +
            "FROM ProductEntity p " +
            "WHERE p.tenantId = :tenantId")
    List<Object[]> checkInventoryIntegrity(@Param("tenantId") UUID tenantId);
}
