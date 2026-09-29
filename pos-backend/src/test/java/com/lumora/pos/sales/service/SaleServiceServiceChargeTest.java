package com.lumora.pos.sales.service;

import com.lumora.pos.TestUtils;
import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.cashsession.repository.CashSessionRepository;
import com.lumora.pos.cashsession.service.CashSessionService;
import com.lumora.pos.credit.service.CreditService;
import com.lumora.pos.customer.repository.CustomerRepository;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.repository.StockLevelRepository;
import com.lumora.pos.loyalty.dto.LoyaltyConfig;
import com.lumora.pos.loyalty.service.LoyaltyService;
import com.lumora.pos.restaurant.entity.ToppingEntity;
import com.lumora.pos.restaurant.entity.ToppingGroupEntity;
import com.lumora.pos.restaurant.repository.ToppingRepository;
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
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * The dine-in service charge (V68). The numbers here are asserted by hand and
 * the frontend's applyServiceCharge test asserts the same ones: the cart and the
 * server compute this twice, and a disagreement would only show at the drawer.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("SaleService — service charge")
class SaleServiceServiceChargeTest {

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
    @Mock private CreditService creditService;
    @Mock private ToppingRepository toppingRepository;

    @InjectMocks private SaleService saleService;

    private UUID dishId;
    private UUID cheeseId;
    private UUID sauceId;
    private ProductEntity dish;
    private ToppingEntity cheese;
    private ToppingEntity sauce;

    @BeforeEach
    void setUp() {
        TestUtils.setupDefaultContext();

        dishId = UUID.randomUUID();
        cheeseId = UUID.randomUUID();
        sauceId = UUID.randomUUID();

        BranchEntity branch = new BranchEntity();
        branch.setId(UUID.randomUUID());

        // Made to order, so no stock plumbing is needed to exercise pricing.
        dish = ProductEntity.builder()
                .name("Margherita")
                .sku("PIZ-001")
                .basePrice(new BigDecimal("1000.00"))
                .lowStockThreshold(0)
                .isActive(true)
                .trackStock(false)
                .build();
        dish.setId(dishId);
        dish.setTenantId(TestUtils.TEST_TENANT_ID);

        ToppingGroupEntity group = ToppingGroupEntity.builder().name("Extras").build();
        group.setId(UUID.randomUUID());
        group.setTenantId(TestUtils.TEST_TENANT_ID);

        cheese = ToppingEntity.builder()
                .group(group)
                .name("Extra cheese")
                .priceMode(ToppingEntity.PriceMode.FIXED)
                .defaultPrice(new BigDecimal("120.00"))
                .isActive(true)
                .build();
        cheese.setId(cheeseId);
        cheese.setTenantId(TestUtils.TEST_TENANT_ID);

        sauce = ToppingEntity.builder()
                .group(group)
                .name("Special sauce")
                .priceMode(ToppingEntity.PriceMode.PROMPT)
                .defaultPrice(new BigDecimal("100.00"))
                .maxPrice(new BigDecimal("250.00"))
                .isActive(true)
                .build();
        sauce.setId(sauceId);
        sauce.setTenantId(TestUtils.TEST_TENANT_ID);

        lenient().when(branchRepository.findByIsDefaultTrueAndTenantId(TestUtils.TEST_TENANT_ID))
                .thenReturn(Optional.of(branch));
        lenient().when(productRepository.findByIdAndTenantId(dishId, TestUtils.TEST_TENANT_ID))
                .thenReturn(Optional.of(dish));
        // mapToResponse batch-fetches product names in one query; topping lines have
        // a null productId and are excluded from that lookup by design.
        lenient().when(productRepository.findAllById(any())).thenReturn(List.of(dish));
        lenient().when(taxRateService.getApplicableRate(any(ProductEntity.class)))
                .thenReturn(new BigDecimal("0.10"));
        // The service charge is taxed at the default rate, like any custom line.
        lenient().when(taxRateService.getDefaultRate(any(UUID.class)))
                .thenReturn(new BigDecimal("0.10"));
        lenient().when(cashSessionService.findActiveEntityByUserId(any(UUID.class)))
                .thenReturn(Optional.empty());
        lenient().when(loyaltyService.getConfig()).thenReturn(LoyaltyConfig.defaults());
        lenient().when(toppingRepository.findByIdAndTenantId(cheeseId, TestUtils.TEST_TENANT_ID))
                .thenReturn(Optional.of(cheese));
        lenient().when(toppingRepository.findByIdAndTenantId(sauceId, TestUtils.TEST_TENANT_ID))
                .thenReturn(Optional.of(sauce));
        lenient().when(saleRepository.save(any(SaleEntity.class))).thenAnswer(invocation -> {
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

    @AfterEach
    void tearDown() {
        TestUtils.clearContext();
    }

    private SaleRequest twoDishes(BigDecimal serviceRate) {
        SaleRequest.SaleItemRequest line = new SaleRequest.SaleItemRequest();
        line.setProductId(dishId);
        line.setQuantity(new BigDecimal("2"));
        line.setUnitPrice(new BigDecimal("1000.00"));
        return SaleRequest.builder()
                .paymentMethod("CASH")
                .serviceChargeRate(serviceRate)
                .items(List.of(line))
                .build();
    }

    private SaleResponse.SaleItemResponse chargeLine(SaleResponse response) {
        return response.getItems().stream()
                .filter(i -> i.getProductName() != null && i.getProductName().startsWith("Service charge"))
                .findFirst().orElseThrow();
    }

    @Test
    @DisplayName("Exclusive pricing: 10% of 2000 is a 200 line, and VAT is charged on it")
    void shouldChargeExclusive() {
        when(tenantInfoService.isTaxInclusive(any())).thenReturn(false);

        SaleResponse sale = saleService.createSale(twoDishes(BigDecimal.TEN));

        assertThat(sale.getServiceChargeAmount()).isEqualByComparingTo("200.00");
        assertThat(chargeLine(sale).getTotalAmount()).isEqualByComparingTo("220.00");
        assertThat(sale.getTaxAmount()).isEqualByComparingTo("220.00");   // 200 on the dishes + 20 on the charge
        assertThat(sale.getNetAmount()).isEqualByComparingTo("2420.00");
        assertThat(sale.isServiceChargeWaived()).isFalse();
    }

    @Test
    @DisplayName("Inclusive pricing: the charge is on the VAT-free value and grossed up")
    void shouldChargeInclusive() {
        when(tenantInfoService.isTaxInclusive(any())).thenReturn(true);

        SaleResponse sale = saleService.createSale(twoDishes(BigDecimal.TEN));

        // 2000 incl. VAT → 1818.18 taxable → charge 181.82 → line 200.00 incl. 18.18 VAT.
        assertThat(sale.getServiceChargeAmount()).isEqualByComparingTo("181.82");
        assertThat(chargeLine(sale).getTotalAmount()).isEqualByComparingTo("200.00");
        assertThat(sale.getTaxAmount()).isEqualByComparingTo("200.00");   // 181.82 + 18.18
        assertThat(sale.getNetAmount()).isEqualByComparingTo("2200.00");
    }

    @Test
    @DisplayName("No rate, no charge line — every retail and takeaway sale")
    void shouldNotChargeWithoutRate() {
        when(tenantInfoService.isTaxInclusive(any())).thenReturn(false);

        SaleResponse sale = saleService.createSale(twoDishes(null));

        assertThat(sale.getServiceChargeAmount()).isEqualByComparingTo("0");
        assertThat(sale.getItems()).hasSize(1);
        assertThat(sale.getNetAmount()).isEqualByComparingTo("2200.00");
    }

    @Test
    @DisplayName("A till cannot set the charge itself: the request fields are not read from JSON")
    void shouldIgnoreClientServiceCharge() throws Exception {
        // Spring's own builder: the same modules the controller's mapper has.
        SaleRequest parsed = org.springframework.http.converter.json.Jackson2ObjectMapperBuilder.json().build().readValue(
                "{\"paymentMethod\":\"CASH\",\"serviceChargeRate\":50,\"serviceChargeWaived\":true,\"items\":[]}",
                SaleRequest.class);

        assertThat(parsed.getServiceChargeRate()).isNull();
        assertThat(parsed.getServiceChargeWaived()).isNull();
    }
}
