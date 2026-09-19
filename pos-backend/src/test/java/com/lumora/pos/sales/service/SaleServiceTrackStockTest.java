package com.lumora.pos.sales.service;

import com.lumora.pos.TestUtils;
import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.cashsession.repository.CashSessionRepository;
import com.lumora.pos.cashsession.service.CashSessionService;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.customer.repository.CustomerRepository;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.entity.StockLevelEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.repository.StockLevelRepository;
import com.lumora.pos.loyalty.dto.LoyaltyConfig;
import com.lumora.pos.loyalty.service.LoyaltyService;
import com.lumora.pos.sales.dto.SaleRequest;
import com.lumora.pos.sales.dto.SaleResponse;
import com.lumora.pos.sales.entity.SaleEntity;
import com.lumora.pos.sales.repository.SaleRepository;
import com.lumora.pos.tax.service.TaxRateService;
import com.lumora.pos.tenant.service.TenantInfoService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Stock-tracking behaviour on the sale path (V59).
 *
 * <p>A made-to-order product ({@code trackStock == false}) is cooked from
 * ingredients rather than drawn from a unit count. Selling one must therefore
 * touch {@code stock_levels} not at all — no lookup, no shortage check, no
 * deduction — and must accept a fractional quantity, since the INTEGER column
 * that forced whole numbers is never read.
 *
 * <p>The negative assertions matter more than the positive ones here: the bug
 * this guards against is a dish that cannot be sold because nobody remembered to
 * create a stock row for it. Tracked products must keep behaving exactly as
 * before, so those cases are re-asserted alongside.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("SaleService — track_stock")
class SaleServiceTrackStockTest {

    @Mock private SaleRepository saleRepository;
    @Mock private ProductRepository productRepository;
    @Mock private CustomerRepository customerRepository;
    @Mock private UserRepository userRepository;
    @Mock private BranchRepository branchRepository;
    @Mock private BranchAccessGuard branchAccessGuard;
    @Mock private StockLevelRepository stockLevelRepository;
    @Mock private AuditService auditService;
    @Mock private TaxRateService taxRateService;
    @Mock private CashSessionService cashSessionService;
    @Mock private CashSessionRepository cashSessionRepository;
    @Mock private PasswordEncoder passwordEncoder;
    @Mock private LoyaltyService loyaltyService;
    @Mock private TenantInfoService tenantInfoService;

    @InjectMocks private SaleService saleService;

    private UUID branchId;
    private UUID trackedId;
    private UUID untrackedId;
    private ProductEntity tracked;
    private ProductEntity untracked;

    @BeforeEach
    void setUp() {
        TestUtils.setupDefaultContext();

        branchId = UUID.randomUUID();
        trackedId = UUID.randomUUID();
        untrackedId = UUID.randomUUID();

        BranchEntity branch = new BranchEntity();
        branch.setId(branchId);

        tracked = ProductEntity.builder()
                .name("Bottled Water")
                .sku("BEV-001")
                .basePrice(new BigDecimal("100.00"))
                .lowStockThreshold(5)
                .isActive(true)
                .trackStock(true)
                .build();
        tracked.setId(trackedId);
        tracked.setTenantId(TestUtils.TEST_TENANT_ID);

        untracked = ProductEntity.builder()
                .name("Chicken Fried Rice")
                .sku("FOOD-001")
                .basePrice(new BigDecimal("850.00"))
                .lowStockThreshold(0)
                .isActive(true)
                .trackStock(false)
                .build();
        untracked.setId(untrackedId);
        untracked.setTenantId(TestUtils.TEST_TENANT_ID);

        lenient().when(branchRepository.findByIsDefaultTrueAndTenantId(TestUtils.TEST_TENANT_ID))
                .thenReturn(Optional.of(branch));
        lenient().when(taxRateService.getApplicableRate(any(ProductEntity.class)))
                .thenReturn(new BigDecimal("0.10"));
        lenient().when(stockLevelRepository.save(any(StockLevelEntity.class)))
                .thenAnswer(inv -> inv.getArgument(0));
        lenient().when(cashSessionService.findActiveEntityByUserId(any(UUID.class)))
                .thenReturn(Optional.empty());
        lenient().when(loyaltyService.getConfig()).thenReturn(LoyaltyConfig.defaults());
    }

    @AfterEach
    void tearDown() {
        TestUtils.clearContext();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private SaleRequest.SaleItemRequest item(UUID productId, String quantity) {
        SaleRequest.SaleItemRequest req = new SaleRequest.SaleItemRequest();
        req.setProductId(productId);
        req.setQuantity(new BigDecimal(quantity));
        req.setUnitPrice(new BigDecimal("1.00")); // ignored: catalogue price wins
        return req;
    }

    private SaleRequest saleOf(SaleRequest.SaleItemRequest... items) {
        return SaleRequest.builder()
                .paymentMethod("CASH")
                .items(Arrays.asList(items))
                .build();
    }

    private void stubSaleSave() {
        when(saleRepository.save(any(SaleEntity.class))).thenAnswer(invocation -> {
            SaleEntity sale = invocation.getArgument(0);
            if (sale.getId() == null) {
                sale.setId(UUID.randomUUID());
            }
            sale.getItems().forEach(line -> {
                if (line.getId() == null) {
                    line.setId(UUID.randomUUID());
                }
            });
            return sale;
        });
    }

    private void stubStock(UUID productId, int quantity) {
        StockLevelEntity level = StockLevelEntity.builder().quantity(quantity).build();
        level.setId(UUID.randomUUID());
        when(stockLevelRepository.findByProductAndBranchForUpdate(
                productId, branchId, TestUtils.TEST_TENANT_ID)).thenReturn(Optional.of(level));
    }

    // ------------------------------------------------------------------
    // Made-to-order products
    // ------------------------------------------------------------------

    @Nested
    @DisplayName("Made to order (trackStock = false)")
    class Untracked {

        @Test
        @DisplayName("sells with no stock row, and never touches stock_levels")
        void sellsWithoutAnyStockRow() {
            // No stubStock() call at all: the repository is left to return
            // Optional.empty() for everything, which is what a product with no
            // stock row actually looks like. Under the old code this threw
            // "Stock record not found".
            when(productRepository.findByIdAndTenantId(untrackedId, TestUtils.TEST_TENANT_ID))
                    .thenReturn(Optional.of(untracked));
            stubSaleSave();

            SaleResponse response = saleService.createSale(saleOf(item(untrackedId, "2")));

            assertThat(response.getItems()).hasSize(1);
            assertThat(response.getTotalAmount()).isEqualByComparingTo("1700.00");

            verify(stockLevelRepository, never())
                    .findByProductAndBranchForUpdate(any(), any(), any());
            verify(stockLevelRepository, never()).save(any(StockLevelEntity.class));
        }

        @Test
        @DisplayName("accepts a fractional quantity")
        void acceptsFractionalQuantity() {
            // 0.5 portions. The integer-truncation guard exists only to protect
            // stock_levels.quantity, which is never read for this product.
            when(productRepository.findByIdAndTenantId(untrackedId, TestUtils.TEST_TENANT_ID))
                    .thenReturn(Optional.of(untracked));
            stubSaleSave();

            SaleResponse response = saleService.createSale(saleOf(item(untrackedId, "0.5")));

            assertThat(response.getTotalAmount()).isEqualByComparingTo("425.00");
            verify(stockLevelRepository, never()).save(any(StockLevelEntity.class));
        }

        @Test
        @DisplayName("is still refused when inactive")
        void inactiveStillRefused() {
            untracked.setActive(false);
            when(productRepository.findByIdAndTenantId(untrackedId, TestUtils.TEST_TENANT_ID))
                    .thenReturn(Optional.of(untracked));

            assertThatThrownBy(() -> saleService.createSale(saleOf(item(untrackedId, "1"))))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("inactive");
        }
    }

    // ------------------------------------------------------------------
    // Tracked products — unchanged behaviour
    // ------------------------------------------------------------------

    @Nested
    @DisplayName("Tracked (trackStock = true) — behaviour is unchanged")
    class Tracked {

        @Test
        @DisplayName("still deducts stock")
        void stillDeducts() {
            when(productRepository.findByIdAndTenantId(trackedId, TestUtils.TEST_TENANT_ID))
                    .thenReturn(Optional.of(tracked));
            stubStock(trackedId, 10);
            stubSaleSave();

            saleService.createSale(saleOf(item(trackedId, "3")));

            ArgumentCaptorHolder.assertDeductedTo(stockLevelRepository, 7);
        }

        @Test
        @DisplayName("still throws when no stock row exists")
        void stillThrowsWithoutStockRow() {
            when(productRepository.findByIdAndTenantId(trackedId, TestUtils.TEST_TENANT_ID))
                    .thenReturn(Optional.of(tracked));
            when(stockLevelRepository.findByProductAndBranchForUpdate(
                    trackedId, branchId, TestUtils.TEST_TENANT_ID)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> saleService.createSale(saleOf(item(trackedId, "1"))))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("Stock record not found");
        }

        @Test
        @DisplayName("still throws when stock is short")
        void stillThrowsWhenShort() {
            when(productRepository.findByIdAndTenantId(trackedId, TestUtils.TEST_TENANT_ID))
                    .thenReturn(Optional.of(tracked));
            stubStock(trackedId, 2);

            assertThatThrownBy(() -> saleService.createSale(saleOf(item(trackedId, "5"))))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("Insufficient stock");
        }

        @Test
        @DisplayName("still rejects a fractional quantity")
        void stillRejectsFractionalQuantity() {
            when(productRepository.findByIdAndTenantId(trackedId, TestUtils.TEST_TENANT_ID))
                    .thenReturn(Optional.of(tracked));

            assertThatThrownBy(() -> saleService.createSale(saleOf(item(trackedId, "1.5"))))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("Fractional quantities are not supported");
        }
    }

    // ------------------------------------------------------------------
    // Mixed basket — the restaurant case
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a basket mixing a dish and a bottled drink deducts only the drink")
    void mixedBasketDeductsOnlyTheTrackedLine() {
        when(productRepository.findByIdAndTenantId(untrackedId, TestUtils.TEST_TENANT_ID))
                .thenReturn(Optional.of(untracked));
        when(productRepository.findByIdAndTenantId(trackedId, TestUtils.TEST_TENANT_ID))
                .thenReturn(Optional.of(tracked));
        stubStock(trackedId, 10);
        stubSaleSave();

        SaleResponse response = saleService.createSale(
                saleOf(item(untrackedId, "1"), item(trackedId, "2")));

        assertThat(response.getItems()).hasSize(2);
        // 850 + 200
        assertThat(response.getTotalAmount()).isEqualByComparingTo("1050.00");

        // Exactly one lookup and one save — the drink's.
        verify(stockLevelRepository, times(1))
                .findByProductAndBranchForUpdate(trackedId, branchId, TestUtils.TEST_TENANT_ID);
        verify(stockLevelRepository, never())
                .findByProductAndBranchForUpdate(untrackedId, branchId, TestUtils.TEST_TENANT_ID);
        verify(stockLevelRepository, times(1)).save(any(StockLevelEntity.class));
    }

    /** Keeps the captor boilerplate out of the test bodies. */
    private static final class ArgumentCaptorHolder {
        static void assertDeductedTo(StockLevelRepository repository, int expected) {
            org.mockito.ArgumentCaptor<StockLevelEntity> captor =
                    org.mockito.ArgumentCaptor.forClass(StockLevelEntity.class);
            verify(repository).save(captor.capture());
            assertThat(captor.getValue().getQuantity()).isEqualTo(expected);
        }
    }
}
