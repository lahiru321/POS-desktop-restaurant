package com.lumora.pos.inventory;

import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.entity.StockLevelEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.repository.StockLevelRepository;
import com.lumora.pos.inventory.service.ProductService;
import com.lumora.pos.superadmin.entity.TenantConfigurationEntity;
import com.lumora.pos.superadmin.repository.TenantConfigurationRepository;
import com.lumora.pos.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * A restaurant menu is mostly cooked-to-order items with no stock count, plus a
 * few bought-in packaged ones. These cover the places that used to treat every
 * item as counted stock: the dashboard's low-stock list, and the menu CSV import.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class MenuItemIntegrationTest {

    @Autowired private ProductService productService;
    @Autowired private ProductRepository productRepository;
    @Autowired private StockLevelRepository stockLevelRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private BranchRepository branchRepository;
    @Autowired private TenantConfigurationRepository tenantConfigurationRepository;
    @Autowired private EntityManager entityManager;

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

        tenantConfigurationRepository.save(TenantConfigurationEntity.builder().tenantId(tenantId).build());
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    @Test
    void lowStockListsOnlyItemsThatAreCounted() {
        ProductEntity kottu = product("Chicken Kottu", false);
        ProductEntity cola = product("Coca-Cola 500ml", true);
        StockLevelEntity stock = StockLevelEntity.builder().product(cola).branch(branch).quantity(2).build();
        stock.setTenantId(tenantId);
        stockLevelRepository.saveAndFlush(stock);
        productRepository.flush();

        List<ProductEntity> low = productRepository.findLowStockProducts(tenantId, PageRequest.of(0, 10));

        // The dish has no stock row, so it reads 0 — and must still not be "low".
        assertThat(low).extracting(ProductEntity::getId).containsExactly(cola.getId());
        assertThat(low).extracting(ProductEntity::getId).doesNotContain(kottu.getId());
    }

    @Test
    void importsAMenuFileAndReimportsWithoutDuplicates() {
        String csv = String.join("\n",
                "name,category,basePrice,trackStock,stockQuantity,lowStockThreshold,barcode,description,costPrice,sku",
                "Chicken Kottu,Kottu,1200.00,false,,,,Spicy,650.00,",
                "Egg Fried Rice,Rice,900.00,false,,,,,,",
                "Coca-Cola 500ml,Drinks,250.00,true,48,12,5449000000996,,180.00,");

        int first = productService.importProductsFromCsv(file(csv));
        int second = productService.importProductsFromCsv(file(csv));

        assertThat(first).isEqualTo(3);
        assertThat(second).isEqualTo(3);
        List<ProductEntity> all = productRepository.findAllByTenantId(tenantId);
        // Blank SKUs matched by name on the second pass, not added again.
        assertThat(all).hasSize(3);

        ProductEntity kottu = byName(all, "Chicken Kottu");
        assertThat(kottu.isTrackStock()).isFalse();
        // Two dishes with no barcode: stored as null, so V29's unique index allows both.
        assertThat(kottu.getBarcode()).isNull();
        assertThat(kottu.getSku()).startsWith("PRD-");
        assertThat(stockLevelRepository.findByProductIdAndBranchIdAndTenantId(kottu.getId(), branch.getId(), tenantId))
                .isEmpty();

        ProductEntity cola = byName(all, "Coca-Cola 500ml");
        assertThat(cola.isTrackStock()).isTrue();
        assertThat(stockLevelRepository.findByProductIdAndBranchIdAndTenantId(cola.getId(), branch.getId(), tenantId))
                .get().extracting(StockLevelEntity::getQuantity).isEqualTo(48);
    }

    @Test
    void anOlderFileWithoutTrackStockKeepsItsStock() {
        String csv = String.join("\n",
                "name,sku,basePrice,stockQuantity",
                "Bottled water,WTR-1,100.00,24",
                "Plain hopper,HPR-1,60.00,");

        productService.importProductsFromCsv(file(csv));

        List<ProductEntity> all = productRepository.findAllByTenantId(tenantId);
        assertThat(byName(all, "Bottled water").isTrackStock()).isTrue();
        assertThat(byName(all, "Plain hopper").isTrackStock()).isFalse();
    }

    @Test
    void anExportReimportsAsIsAndLeavesStockAlone() {
        productService.importProductsFromCsv(file(String.join("\n",
                "name,category,basePrice,trackStock,stockQuantity,lowStockThreshold,barcode,description,costPrice,sku",
                "Chicken Kottu,Kottu,1200.00,false,,,,\"Spicy, with egg\",650.00,",
                "Coca-Cola 500ml,Drinks,250.00,true,48,12,5449000000996,,180.00,")));
        entityManager.flush();
        entityManager.clear(); // stock is a @Formula: read it fresh, as the export request would

        String exported = new String(productService.exportProductsToCsv(), StandardCharsets.UTF_8);

        assertThat(exported).startsWith("﻿" + String.join(",", ProductService.MENU_CSV_COLUMNS) + "\r\n");
        // A dish has no count: blank stock cells, not 0. No retail Brand column.
        assertThat(exported).contains("Chicken Kottu,Kottu,1200.00,650.00,false,,,PRD-");
        assertThat(exported).contains("Coca-Cola 500ml,Drinks,250.00,180.00,true,48,12,");
        assertThat(exported).doesNotContainIgnoringCase("brand");

        // Someone sold 6 colas since; re-importing the export must not reset the count.
        ProductEntity cola = byName(productRepository.findAllByTenantId(tenantId), "Coca-Cola 500ml");
        StockLevelEntity level = stockLevelRepository
                .findByProductIdAndBranchIdAndTenantId(cola.getId(), branch.getId(), tenantId).orElseThrow();
        level.setQuantity(42);
        stockLevelRepository.saveAndFlush(level);

        int count = productService.importProductsFromCsv(file(exported));

        assertThat(count).isEqualTo(2);
        List<ProductEntity> all = productRepository.findAllByTenantId(tenantId);
        assertThat(all).hasSize(2);
        assertThat(byName(all, "Chicken Kottu").getDescription()).isEqualTo("Spicy, with egg");
        assertThat(stockLevelRepository.findByProductIdAndBranchIdAndTenantId(cola.getId(), branch.getId(), tenantId))
                .get().extracting(StockLevelEntity::getQuantity).isEqualTo(42);
    }

    @Test
    void readsTheOldRetailExportHeaders() {
        String csv = String.join("\n",
                "Name,SKU,Barcode,Description,Base Price,Cost Price,Stock,Low Stock Threshold,Category,Brand,Is Active",
                "Bottled water,WTR-1,,,\"1,100.00\",80.00,24,6,Drinks,,true",
                "Old special,OLD-1,,,500.00,,0,5,Mains,,false");

        productService.importProductsFromCsv(file(csv));

        List<ProductEntity> all = productRepository.findAllByTenantId(tenantId);
        ProductEntity water = byName(all, "Bottled water");
        assertThat(water.getBasePrice()).isEqualByComparingTo("1100.00");
        assertThat(water.isTrackStock()).isTrue();
        assertThat(water.getLowStockThreshold()).isEqualTo(6);
        assertThat(water.getCategory().getName()).isEqualTo("Drinks");
        assertThat(byName(all, "Old special").isActive()).isFalse();
    }

    @Test
    void namesTheRowThatIsWrong() {
        String csv = String.join("\n",
                "name,basePrice,trackStock",
                "Chicken Kottu,1200.00,false",
                "Egg Fried Rice,nine hundred,false");

        assertThatThrownBy(() -> productService.importProductsFromCsv(file(csv)))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Row 3")
                .hasMessageContaining("nine hundred");
    }

    private ProductEntity product(String name, boolean trackStock) {
        ProductEntity p = ProductEntity.builder()
                .name(name).sku("SKU-" + UUID.randomUUID().toString().substring(0, 8))
                .basePrice(new BigDecimal("100.00")).lowStockThreshold(5)
                .trackStock(trackStock).isActive(true).build();
        p.setTenantId(tenantId);
        return productRepository.save(p);
    }

    private static MockMultipartFile file(String csv) {
        return new MockMultipartFile("file", "menu.csv", "text/csv", csv.getBytes(StandardCharsets.UTF_8));
    }

    private static ProductEntity byName(List<ProductEntity> all, String name) {
        return all.stream().filter(p -> p.getName().equals(name)).findFirst().orElseThrow();
    }
}
