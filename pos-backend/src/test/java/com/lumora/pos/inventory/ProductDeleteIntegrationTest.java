package com.lumora.pos.inventory;

import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.entity.InventoryAdjustmentEntity;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.InventoryAdjustmentRepository;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.service.ProductService;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Collections;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Deleting a product is blocked by the restricting FKs that purchase-order
 * items, return items, inventory adjustments and stock transfers hold against
 * products(id). These cover that the block surfaces as a readable
 * BusinessException (a 400 the UI can show) rather than a raw constraint
 * violation, and that an untouched product still deletes cleanly.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ProductDeleteIntegrationTest {

    @Autowired private ProductService productService;
    @Autowired private ProductRepository productRepository;
    @Autowired private InventoryAdjustmentRepository adjustmentRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private BranchRepository branchRepository;

    private UUID tenantId;
    private BranchEntity branch;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);

        UserEntity admin = UserEntity.builder()
                .email("admin-" + UUID.randomUUID() + "@test.local")
                .passwordHash("x").firstName("Test").lastName("Admin").isActive(true).build();
        admin.setTenantId(tenantId);
        admin = userRepository.save(admin);

        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(admin.getId(), null, Collections.emptyList()));

        branch = BranchEntity.builder().name("Main").isDefault(true).isActive(true).build();
        branch.setTenantId(tenantId);
        branch = branchRepository.save(branch);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    private ProductEntity newProduct(String sku) {
        ProductEntity p = ProductEntity.builder()
                .name("Widget " + sku).sku(sku).basePrice(new BigDecimal("10.00"))
                .lowStockThreshold(1).isActive(true).build();
        p.setTenantId(tenantId);
        return productRepository.save(p);
    }

    @Test
    void deletesProductWithNoHistory() {
        ProductEntity product = newProduct("CLEAN-1");

        productService.deleteProduct(product.getId());

        assertThat(productRepository.findByIdAndTenantId(product.getId(), tenantId)).isEmpty();
    }

    @Test
    void refusesToDeleteProductWithInventoryHistory() {
        ProductEntity product = newProduct("HELD-1");

        InventoryAdjustmentEntity adj = new InventoryAdjustmentEntity();
        adj.setProduct(product);
        adj.setBranch(branch);
        adj.setType(InventoryAdjustmentEntity.AdjustmentType.RECONCILIATION);
        adj.setQuantity(5);
        adj.setPreviousQuantity(0);
        adj.setNewQuantity(5);
        adj.setReason("Stock take");
        adj.setTenantId(tenantId);
        adjustmentRepository.save(adj);

        assertThatThrownBy(() -> productService.deleteProduct(product.getId()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("cannot be deleted")
                .hasMessageContaining("Deactivate it instead");
    }
}
