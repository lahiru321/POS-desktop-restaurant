package com.lumora.pos.report;

import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.cashsession.repository.CashSessionRepository;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.InventoryAdjustmentRepository;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.purchase.repository.PurchaseOrderItemRepository;
import com.lumora.pos.report.service.ReportService;
import com.lumora.pos.sales.entity.SaleEntity;
import com.lumora.pos.sales.entity.SaleItemEntity;
import com.lumora.pos.sales.repository.SaleRepository;
import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.customer.repository.CustomerRepository;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Guards against N+1 query regressions in ReportService.
 *
 * <p>ReportService uses batch-fetch (findAllById) to load cashier names and product details
 * for a page of sales. This test verifies that pattern is preserved: regardless of how
 * many sales or sale-items are in the page, the repository is called exactly once per batch,
 * not once per sale.
 *
 * <p>We use Mockito (not @DataJpaTest) because the batch-fetch contract is enforced at the
 * service layer — we verify call counts on mocked repositories, which is cheaper and faster
 * than running a full in-memory DB. A true @DataJpaTest would additionally catch raw JPQL
 * regressions; that can be added when a dedicated test datasource is wired for CI.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("ReportService — N+1 query guard")
class ReportServiceQueryGuardTest {

    @Mock private SaleRepository saleRepository;
    @Mock private ProductRepository productRepository;
    @Mock private UserRepository userRepository;
    @Mock private CustomerRepository customerRepository;
    @Mock private com.lumora.pos.credit.repository.CreditTransactionRepository creditTransactionRepository;
    @Mock private PurchaseOrderItemRepository purchaseOrderItemRepository;
    @Mock private InventoryAdjustmentRepository inventoryAdjustmentRepository;
    @Mock private CashSessionRepository cashSessionRepository;
    @Mock private BranchAccessGuard branchAccessGuard;

    private ReportService reportService;
    private final UUID tenantId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        reportService = new ReportService(
                saleRepository, productRepository, userRepository, customerRepository,
                creditTransactionRepository, purchaseOrderItemRepository, inventoryAdjustmentRepository,
                cashSessionRepository, branchAccessGuard
        );
        TenantContext.setTenantId(tenantId);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    /**
     * With N=5 sales each having 3 distinct products and 2 distinct cashiers,
     * getSalesReport() must call:
     *  - saleRepository.findByTenantIdAndCreatedAtBetween — exactly 1 time
     *  - userRepository.findAllById                       — exactly 1 time  (batch, not 5 × 1)
     *  - productRepository.findAllById                    — exactly 1 time  (batch, not 15 × 1)
     */
    @Test
    @DisplayName("getSalesReport batch-fetches users and products in one call each")
    void getSalesReport_batchFetchesUsersAndProducts() {
        int salesCount = 5;
        int productsPerSale = 3;

        UUID cashier1 = UUID.randomUUID();
        UUID cashier2 = UUID.randomUUID();
        List<UUID> productIds = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());

        List<SaleEntity> sales = buildSales(salesCount, productsPerSale, List.of(cashier1, cashier2), productIds);

        when(branchAccessGuard.reportBranchFilter(any())).thenReturn(Optional.empty());

        when(saleRepository.findByTenantIdAndCreatedAtBetween(
                eq(tenantId), any(), any(), any()))
                .thenReturn(new PageImpl<>(sales, PageRequest.of(0, 15), sales.size()));

        when(userRepository.findAllById(anyIterable()))
                .thenReturn(buildUsers(cashier1, cashier2));

        when(productRepository.findAllById(anyIterable()))
                .thenReturn(buildProducts(productIds));

        reportService.getSalesReport(
                LocalDateTime.now().minusDays(7),
                LocalDateTime.now(),
                null,
                PageRequest.of(0, 15));

        // Batch-fetch must be called exactly once regardless of how many sales are in the page.
        verify(userRepository, times(1)).findAllById(anyIterable());
        verify(productRepository, times(1)).findAllById(anyIterable());

        // The individual findById must NEVER be called — that would be an N+1.
        verify(userRepository, never()).findById(any(UUID.class));
        verify(productRepository, never()).findById(any(UUID.class));
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private List<SaleEntity> buildSales(int count, int itemsPerSale, List<UUID> cashierIds, List<UUID> productIds) {
        List<SaleEntity> result = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            SaleEntity sale = new SaleEntity();
            sale.setTenantId(tenantId);
            sale.setInvoiceNumber("INV-" + i);
            sale.setTotalAmount(BigDecimal.TEN);
            sale.setTaxAmount(BigDecimal.ZERO);
            sale.setDiscountAmount(BigDecimal.ZERO);
            sale.setNetAmount(BigDecimal.TEN);
            sale.setCashTendered(BigDecimal.TEN);
            sale.setPaymentMethod(SaleEntity.PaymentMethod.CASH);
            sale.setPaymentStatus(SaleEntity.PaymentStatus.PAID);
            // Alternate cashiers to ensure multiple distinct IDs are collected.
            sale.setCreatedBy(cashierIds.get(i % cashierIds.size()));

            List<SaleItemEntity> items = new ArrayList<>();
            for (int j = 0; j < itemsPerSale; j++) {
                SaleItemEntity item = new SaleItemEntity();
                item.setProductId(productIds.get(j % productIds.size()));
                item.setQuantity(BigDecimal.ONE);
                item.setUnitPrice(BigDecimal.TEN);
                item.setTaxAmount(BigDecimal.ZERO);
                item.setDiscountAmount(BigDecimal.ZERO);
                item.setTotalAmount(BigDecimal.TEN);
                items.add(item);
            }
            sale.setItems(items);
            result.add(sale);
        }
        return result;
    }

    private List<UserEntity> buildUsers(UUID... ids) {
        List<UserEntity> users = new ArrayList<>();
        for (UUID id : ids) {
            UserEntity u = new UserEntity();
            u.setId(id);
            u.setFirstName("Test");
            u.setLastName("User");
            users.add(u);
        }
        return users;
    }

    private List<ProductEntity> buildProducts(List<UUID> ids) {
        List<ProductEntity> products = new ArrayList<>();
        for (UUID id : ids) {
            ProductEntity p = new ProductEntity();
            p.setId(id);
            p.setName("Product-" + id.toString().substring(0, 4));
            products.add(p);
        }
        return products;
    }
}
