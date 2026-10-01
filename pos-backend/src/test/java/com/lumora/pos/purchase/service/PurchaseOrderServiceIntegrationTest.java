package com.lumora.pos.purchase.service;

import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.ingredient.entity.IngredientEntity;
import com.lumora.pos.ingredient.entity.IngredientMovementEntity;
import com.lumora.pos.ingredient.entity.IngredientUnit;
import com.lumora.pos.ingredient.repository.IngredientMovementRepository;
import com.lumora.pos.ingredient.repository.IngredientRepository;
import com.lumora.pos.ingredient.repository.IngredientStockLevelRepository;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.entity.StockLevelEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.repository.StockLevelRepository;
import com.lumora.pos.purchase.dto.PurchaseOrderRequest;
import com.lumora.pos.purchase.dto.PurchaseOrderResponse;
import com.lumora.pos.purchase.dto.ReceivePoItemRequest;
import com.lumora.pos.purchase.entity.PurchaseOrderEntity;
import com.lumora.pos.purchase.repository.PurchaseOrderRepository;
import com.lumora.pos.supplier.entity.SupplierEntity;
import com.lumora.pos.supplier.repository.SupplierRepository;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies the receive-PO path actually moves stock. The variance side
 * (under-receive vs. over-order) is the easy place to introduce silent bugs:
 * a service that forgets to call the stock-update would leave PO status
 * RECEIVED but inventory unchanged. These tests fail loudly if that happens.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class PurchaseOrderServiceIntegrationTest {

    @Autowired private PurchaseOrderService purchaseOrderService;
    @Autowired private PurchaseOrderRepository purchaseOrderRepository;
    @Autowired private SupplierRepository supplierRepository;
    @Autowired private BranchRepository branchRepository;
    @Autowired private ProductRepository productRepository;
    @Autowired private StockLevelRepository stockLevelRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private IngredientRepository ingredientRepository;
    @Autowired private IngredientStockLevelRepository ingredientStockLevelRepository;
    @Autowired private IngredientMovementRepository ingredientMovementRepository;

    private UUID tenantId;
    private BranchEntity branch;
    private SupplierEntity supplier;
    private ProductEntity product;
    private IngredientEntity rice;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);

        UserEntity admin = UserEntity.builder()
                .email("admin-" + UUID.randomUUID() + "@test.local")
                .passwordHash("x")
                .firstName("Test").lastName("Admin")
                .isActive(true)
                .build();
        admin.setTenantId(tenantId);
        admin = userRepository.save(admin);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(admin.getId(), null, Collections.emptyList()));

        branch = BranchEntity.builder().name("Warehouse").isDefault(true).isActive(true).build();
        branch.setTenantId(tenantId);
        branch = branchRepository.save(branch);

        supplier = SupplierEntity.builder().name("Acme Supply").isActive(true).build();
        supplier.setTenantId(tenantId);
        supplier = supplierRepository.save(supplier);

        product = ProductEntity.builder()
                .name("Widget")
                .sku("W-1")
                .basePrice(new BigDecimal("10.00"))
                .costPrice(new BigDecimal("5.00"))
                .stockQuantity(20)
                .lowStockThreshold(1)
                .isActive(true)
                .build();
        product.setTenantId(tenantId);
        product = productRepository.save(product);

        // Seed initial stock at the receiving branch.
        StockLevelEntity stock = StockLevelEntity.builder()
                .product(product).branch(branch).quantity(20).build();
        stock.setTenantId(tenantId);
        stockLevelRepository.save(stock);

        rice = IngredientEntity.builder()
                .name("Basmati rice")
                .unit(IngredientUnit.KG)
                .costPerUnit(new BigDecimal("400.0000"))
                .lowStockThreshold(new BigDecimal("5.000"))
                .isActive(true)
                .build();
        rice.setTenantId(tenantId);
        rice = ingredientRepository.save(rice);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    @Test
    void receivePO_fullyReceived_increasesStockAndMarksReceived() {
        PurchaseOrderResponse po = createDraftPo(50, new BigDecimal("4.00"));
        UUID poItemId = po.getItems().get(0).getId();

        purchaseOrderService.receivePurchaseOrder(po.getId(), List.of(
                ReceivePoItemRequest.builder().poItemId(poItemId).receivedQuantity(new BigDecimal("50")).build()));

        StockLevelEntity stock = stockLevelRepository
                .findByProductIdAndBranchIdAndTenantId(product.getId(), branch.getId(), tenantId)
                .orElseThrow();
        assertThat(stock.getQuantity()).isEqualTo(70); // 20 seed + 50 received

        PurchaseOrderEntity persisted = purchaseOrderRepository.findById(po.getId()).orElseThrow();
        assertThat(persisted.getStatus()).isEqualTo(PurchaseOrderEntity.POStatus.RECEIVED);

        // Cost price gets pulled from the PO's unit cost.
        ProductEntity refreshed = productRepository.findById(product.getId()).orElseThrow();
        assertThat(refreshed.getCostPrice()).isEqualByComparingTo("4.00");
    }

    @Test
    void receivePO_partialReceive_leavesStatusAsPartial() {
        PurchaseOrderResponse po = createDraftPo(10, new BigDecimal("3.00"));
        UUID poItemId = po.getItems().get(0).getId();

        purchaseOrderService.receivePurchaseOrder(po.getId(), List.of(
                ReceivePoItemRequest.builder().poItemId(poItemId).receivedQuantity(new BigDecimal("4")).build()));

        StockLevelEntity stock = stockLevelRepository
                .findByProductIdAndBranchIdAndTenantId(product.getId(), branch.getId(), tenantId)
                .orElseThrow();
        assertThat(stock.getQuantity()).isEqualTo(24); // 20 + 4

        PurchaseOrderEntity persisted = purchaseOrderRepository.findById(po.getId()).orElseThrow();
        assertThat(persisted.getStatus()).isEqualTo(PurchaseOrderEntity.POStatus.PARTIAL);
    }

    @Test
    void receivePO_overReceive_throwsAndLeavesStockUntouched() {
        PurchaseOrderResponse po = createDraftPo(10, new BigDecimal("3.00"));
        UUID poItemId = po.getItems().get(0).getId();

        assertThatThrownBy(() -> purchaseOrderService.receivePurchaseOrder(po.getId(), List.of(
                ReceivePoItemRequest.builder().poItemId(poItemId).receivedQuantity(new BigDecimal("11")).build())))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Cannot receive more than ordered");

        StockLevelEntity stock = stockLevelRepository
                .findByProductIdAndBranchIdAndTenantId(product.getId(), branch.getId(), tenantId)
                .orElseThrow();
        assertThat(stock.getQuantity()).isEqualTo(20); // unchanged
    }

    @Test
    void receivePO_alreadyReceived_throws() {
        PurchaseOrderResponse po = createDraftPo(2, new BigDecimal("1.00"));
        UUID poItemId = po.getItems().get(0).getId();

        purchaseOrderService.receivePurchaseOrder(po.getId(), List.of(
                ReceivePoItemRequest.builder().poItemId(poItemId).receivedQuantity(new BigDecimal("2")).build()));

        assertThatThrownBy(() -> purchaseOrderService.receivePurchaseOrder(po.getId(), List.of(
                ReceivePoItemRequest.builder().poItemId(poItemId).receivedQuantity(new BigDecimal("1")).build())))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("already fully received");
    }

    @Test
    void receivePO_ingredientLine_addsStockWritesMovementAndTakesLastCost() {
        PurchaseOrderResponse po = purchaseOrderService.createPurchaseOrder(PurchaseOrderRequest.builder()
                .supplierId(supplier.getId())
                .branchId(branch.getId())
                .items(List.of(ingredientLine(new BigDecimal("2.5"), new BigDecimal("450.00"))))
                .build());
        PurchaseOrderResponse.PurchaseOrderItemResponse line = po.getItems().get(0);
        assertThat(line.getItemType()).isEqualTo("INGREDIENT");
        assertThat(line.getName()).isEqualTo("Basmati rice");
        assertThat(line.getUnit()).isEqualTo("KG");
        assertThat(po.getTotalAmount()).isEqualByComparingTo("1125.00");

        purchaseOrderService.receivePurchaseOrder(po.getId(), List.of(
                ReceivePoItemRequest.builder().poItemId(line.getId()).receivedQuantity(new BigDecimal("1.25")).build()));
        purchaseOrderService.receivePurchaseOrder(po.getId(), List.of(
                ReceivePoItemRequest.builder().poItemId(line.getId()).receivedQuantity(new BigDecimal("1.25")).build()));

        assertThat(ingredientStockLevelRepository
                .findByIngredientIdAndBranchIdAndTenantId(rice.getId(), branch.getId(), tenantId)
                .orElseThrow().getQuantity()).isEqualByComparingTo("2.5");
        assertThat(ingredientRepository.findById(rice.getId()).orElseThrow().getCostPerUnit())
                .isEqualByComparingTo("450");
        assertThat(purchaseOrderRepository.findById(po.getId()).orElseThrow().getStatus())
                .isEqualTo(PurchaseOrderEntity.POStatus.RECEIVED);

        List<IngredientMovementEntity> movements = ingredientMovementRepository
                .findAllByTenantIdAndIngredientIdOrderByCreatedAtDesc(tenantId, rice.getId(), PageRequest.of(0, 10))
                .getContent();
        assertThat(movements).hasSize(2).allSatisfy(m -> {
            assertThat(m.getMovementType()).isEqualTo(IngredientMovementEntity.MovementType.PURCHASE);
            assertThat(m.getReferenceId()).isEqualTo(po.getId());
            assertThat(m.getQuantityChange()).isEqualByComparingTo("1.25");
        });
        assertThat(movements).extracting(m -> m.getQuantityAfter().stripTrailingZeros().toPlainString())
                .containsExactlyInAnyOrder("1.25", "2.5");
    }

    @Test
    void createPO_mixedIngredientAndPackagedItem_receivesBoth() {
        PurchaseOrderResponse po = purchaseOrderService.createPurchaseOrder(PurchaseOrderRequest.builder()
                .supplierId(supplier.getId())
                .branchId(branch.getId())
                .items(List.of(
                        ingredientLine(new BigDecimal("2.5"), new BigDecimal("450.00")),
                        PurchaseOrderRequest.PurchaseOrderItemRequest.builder()
                                .productId(product.getId())
                                .quantity(new BigDecimal("24"))
                                .unitCost(new BigDecimal("60.00"))
                                .build()))
                .build());
        assertThat(po.getTotalAmount()).isEqualByComparingTo("2565.00"); // 1125 + 1440

        purchaseOrderService.receivePurchaseOrder(po.getId(), po.getItems().stream()
                .map(i -> ReceivePoItemRequest.builder().poItemId(i.getId())
                        .receivedQuantity(i.getOrderedQuantity()).build())
                .toList());

        assertThat(stockLevelRepository
                .findByProductIdAndBranchIdAndTenantId(product.getId(), branch.getId(), tenantId)
                .orElseThrow().getQuantity()).isEqualTo(44); // 20 + 24
        assertThat(ingredientStockLevelRepository
                .findByIngredientIdAndBranchIdAndTenantId(rice.getId(), branch.getId(), tenantId)
                .orElseThrow().getQuantity()).isEqualByComparingTo("2.5");
        assertThat(purchaseOrderRepository.findById(po.getId()).orElseThrow().getStatus())
                .isEqualTo(PurchaseOrderEntity.POStatus.RECEIVED);
    }

    @Test
    void createPO_untrackedMenuItem_isRefused() {
        product.setTrackStock(false);
        productRepository.save(product);

        assertThatThrownBy(() -> createDraftPo(5, new BigDecimal("1.00")))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("made to order");
    }

    @Test
    void createPO_fractionalMenuItemQuantity_isRefused() {
        assertThatThrownBy(() -> purchaseOrderService.createPurchaseOrder(PurchaseOrderRequest.builder()
                .supplierId(supplier.getId())
                .branchId(branch.getId())
                .items(List.of(PurchaseOrderRequest.PurchaseOrderItemRequest.builder()
                        .productId(product.getId())
                        .quantity(new BigDecimal("1.5"))
                        .unitCost(BigDecimal.ONE)
                        .build()))
                .build()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("whole units");
    }

    @Test
    void createPO_lineWithBothOrNeitherItem_isRefused() {
        PurchaseOrderRequest.PurchaseOrderItemRequest both = ingredientLine(BigDecimal.ONE, BigDecimal.ONE);
        both.setProductId(product.getId());
        PurchaseOrderRequest.PurchaseOrderItemRequest neither = PurchaseOrderRequest.PurchaseOrderItemRequest
                .builder().quantity(BigDecimal.ONE).unitCost(BigDecimal.ONE).build();

        for (PurchaseOrderRequest.PurchaseOrderItemRequest line : List.of(both, neither)) {
            assertThatThrownBy(() -> purchaseOrderService.createPurchaseOrder(PurchaseOrderRequest.builder()
                    .supplierId(supplier.getId())
                    .branchId(branch.getId())
                    .items(List.of(line))
                    .build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("either an ingredient or a menu item");
        }
    }

    @Test
    void receivePO_ingredientOverReceive_throwsAndLeavesNoStock() {
        PurchaseOrderResponse po = purchaseOrderService.createPurchaseOrder(PurchaseOrderRequest.builder()
                .supplierId(supplier.getId())
                .branchId(branch.getId())
                .items(List.of(ingredientLine(new BigDecimal("2.5"), new BigDecimal("450"))))
                .build());

        assertThatThrownBy(() -> purchaseOrderService.receivePurchaseOrder(po.getId(), List.of(
                ReceivePoItemRequest.builder().poItemId(po.getItems().get(0).getId())
                        .receivedQuantity(new BigDecimal("2.501")).build())))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Cannot receive more than ordered");
        assertThat(ingredientStockLevelRepository
                .findByIngredientIdAndBranchIdAndTenantId(rice.getId(), branch.getId(), tenantId)).isEmpty();
    }

    private PurchaseOrderRequest.PurchaseOrderItemRequest ingredientLine(BigDecimal qty, BigDecimal unitCost) {
        return PurchaseOrderRequest.PurchaseOrderItemRequest.builder()
                .ingredientId(rice.getId())
                .quantity(qty)
                .unitCost(unitCost)
                .build();
    }

    private PurchaseOrderResponse createDraftPo(int qty, BigDecimal unitCost) {
        PurchaseOrderRequest.PurchaseOrderItemRequest itemReq = PurchaseOrderRequest.PurchaseOrderItemRequest.builder()
                .productId(product.getId())
                .quantity(BigDecimal.valueOf(qty))
                .unitCost(unitCost)
                .build();

        PurchaseOrderRequest req = PurchaseOrderRequest.builder()
                .supplierId(supplier.getId())
                .branchId(branch.getId())
                .items(List.of(itemReq))
                .build();

        return purchaseOrderService.createPurchaseOrder(req);
    }
}
