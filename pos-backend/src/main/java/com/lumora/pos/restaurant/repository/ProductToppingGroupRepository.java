package com.lumora.pos.restaurant.repository;

import com.lumora.pos.restaurant.entity.ProductToppingGroupEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ProductToppingGroupRepository extends JpaRepository<ProductToppingGroupEntity, UUID> {

    List<ProductToppingGroupEntity> findAllByProductIdAndTenantIdOrderBySortOrderAsc(UUID productId, UUID tenantId);

    void deleteAllByProductIdAndTenantId(UUID productId, UUID tenantId);

    /**
     * Ids of every product that has at least one topping group attached.
     *
     * <p>One small query, cached by the till, so a tile only opens the add-on
     * picker when it actually has questions to ask. Without it the till would
     * either round-trip on every tap or flash an empty dialog at a retail
     * cashier.
     */
    @Query("SELECT DISTINCT ptg.product.id FROM ProductToppingGroupEntity ptg "
            + "WHERE ptg.tenantId = :tenantId")
    List<UUID> findProductIdsWithToppings(@Param("tenantId") UUID tenantId);
}
