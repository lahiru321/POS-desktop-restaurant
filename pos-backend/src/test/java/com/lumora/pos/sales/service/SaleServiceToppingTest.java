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
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Add-ons on the sale path (V60/V61).
 *
 * <p>Two things are under test here and they matter for different reasons.
 *
 * <p>The first is <b>pricing authority</b>. A FIXED topping must bill its
 * configured price and discard whatever the client sent, exactly as a catalogue
 * product does; a PROMPT topping is the one narrow, bounded, opt-in exemption.
 * If a FIXED topping ever honoured a request price, the catalogue rule would have
 * a hole in it that nothing else would catch.
 *
 * <p>The second is <b>line structure</b>. A topping is a child row with a null
 * productId, which is what keeps it out of every existing product report without
 * touching a single query.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("SaleService — toppings")
class SaleServiceToppingTest {

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

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private SaleRequest.SaleItemToppingRequest topping(UUID id, String quantity, String unitPrice) {
        return SaleRequest.SaleItemToppingRequest.builder()
                .toppingId(id)
                .quantity(quantity == null ? null : new BigDecimal(quantity))
                .unitPrice(unitPrice == null ? null : new BigDecimal(unitPrice))
                .build();
    }

    private SaleRequest saleWith(String dishQty, SaleRequest.SaleItemToppingRequest... toppings) {
        SaleRequest.SaleItemRequest line = new SaleRequest.SaleItemRequest();
        line.setProductId(dishId);
        line.setQuantity(new BigDecimal(dishQty));
        line.setUnitPrice(new BigDecimal("1.00")); // ignored — catalogue price wins
        line.setToppings(Arrays.asList(toppings));
        return SaleRequest.builder()
                .paymentMethod("CASH")
                .items(List.of(line))
                .build();
    }

    private SaleResponse.SaleItemResponse lineNamed(SaleResponse response, String name) {
        return response.getItems().stream()
                .filter(i -> name.equals(i.getProductName()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No line named " + name));
    }

    // ------------------------------------------------------------------
    // Pricing authority
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a FIXED topping bills its configured price and ignores the client's")
    void fixedToppingIgnoresClientPrice() {
        // Client claims the cheese costs 1.00. It does not.
        SaleResponse response = saleService.createSale(
                saleWith("1", topping(cheeseId, "1", "1.00")));

        assertThat(lineNamed(response, "Extra cheese").getUnitPrice())
                .isEqualByComparingTo("120.00");
        assertThat(response.getTotalAmount()).isEqualByComparingTo("1120.00");
    }

    @Test
    @DisplayName("a PROMPT topping accepts the price the cashier typed")
    void promptToppingAcceptsTypedPrice() {
        SaleResponse response = saleService.createSale(
                saleWith("1", topping(sauceId, "1", "180.00")));

        assertThat(lineNamed(response, "Special sauce").getUnitPrice())
                .isEqualByComparingTo("180.00");
        assertThat(response.getTotalAmount()).isEqualByComparingTo("1180.00");
    }

    @Test
    @DisplayName("a PROMPT topping above its ceiling is refused")
    void promptToppingAboveCeilingRefused() {
        assertThatThrownBy(() -> saleService.createSale(
                saleWith("1", topping(sauceId, "1", "400.00"))))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("exceeds the allowed maximum");
    }

    @Test
    @DisplayName("a PROMPT topping with no price is refused rather than billed at zero")
    void promptToppingWithoutPriceRefused() {
        assertThatThrownBy(() -> saleService.createSale(
                saleWith("1", topping(sauceId, "1", null))))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("A price is required");
    }

    @Test
    @DisplayName("an inactive topping cannot be sold")
    void inactiveToppingRefused() {
        cheese.setActive(false);

        assertThatThrownBy(() -> saleService.createSale(
                saleWith("1", topping(cheeseId, "1", null))))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("no longer available");
    }

    @Test
    @DisplayName("an unknown topping id is refused")
    void unknownToppingRefused() {
        UUID ghost = UUID.randomUUID();
        when(toppingRepository.findByIdAndTenantId(ghost, TestUtils.TEST_TENANT_ID))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> saleService.createSale(
                saleWith("1", topping(ghost, "1", null))))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Topping not found");
    }

    // ------------------------------------------------------------------
    // Line structure
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a topping becomes a child row with a null productId and a toppingId")
    void toppingIsAChildRow() {
        SaleResponse response = saleService.createSale(
                saleWith("1", topping(cheeseId, "1", null)));

        assertThat(response.getItems()).hasSize(2);

        SaleResponse.SaleItemResponse parent = lineNamed(response, "Margherita");
        SaleResponse.SaleItemResponse child = lineNamed(response, "Extra cheese");

        assertThat(parent.getParentItemId()).isNull();
        assertThat(parent.getProductId()).isEqualTo(dishId);
        assertThat(parent.getToppingId()).isNull();

        // Null productId is what keeps toppings out of every product report:
        // they all filter "product_id IS NOT NULL".
        assertThat(child.getProductId()).isNull();
        assertThat(child.getToppingId()).isEqualTo(cheeseId);
        assertThat(child.getParentItemId()).isEqualTo(parent.getId());
        assertThat(child.getSortOrder()).isGreaterThan(parent.getSortOrder());
    }

    @Test
    @DisplayName("a topping inherits the parent dish's tax rate")
    void toppingInheritsParentTaxRate() {
        // 10% exclusive on both lines: dish 1000 -> 100 tax, cheese 120 -> 12 tax.
        SaleResponse response = saleService.createSale(
                saleWith("1", topping(cheeseId, "1", null)));

        assertThat(lineNamed(response, "Margherita").getTaxAmount()).isEqualByComparingTo("100.00");
        assertThat(lineNamed(response, "Extra cheese").getTaxAmount()).isEqualByComparingTo("12.00");
        assertThat(response.getTaxAmount()).isEqualByComparingTo("112.00");
    }

    @Test
    @DisplayName("topping quantity is per parent unit, so two pizzas get two cheeses")
    void toppingQuantityMultipliesByParentQuantity() {
        SaleResponse response = saleService.createSale(
                saleWith("2", topping(cheeseId, "1", null)));

        assertThat(lineNamed(response, "Extra cheese").getQuantity()).isEqualByComparingTo("2");
        // 2 x 1000 + 2 x 120
        assertThat(response.getTotalAmount()).isEqualByComparingTo("2240.00");
    }

    @Test
    @DisplayName("a doubled topping on a doubled dish bills four portions")
    void toppingOwnQuantityCompounds() {
        SaleResponse response = saleService.createSale(
                saleWith("2", topping(cheeseId, "2", null)));

        assertThat(lineNamed(response, "Extra cheese").getQuantity()).isEqualByComparingTo("4");
        // 2 x 1000 + 4 x 120
        assertThat(response.getTotalAmount()).isEqualByComparingTo("2480.00");
    }

    @Test
    @DisplayName("several toppings on one dish each become their own line")
    void multipleToppingsEachGetALine() {
        SaleResponse response = saleService.createSale(
                saleWith("1", topping(cheeseId, "1", null), topping(sauceId, "1", "150.00")));

        assertThat(response.getItems()).hasSize(3);
        // 1000 + 120 + 150
        assertThat(response.getTotalAmount()).isEqualByComparingTo("1270.00");
    }

    @Test
    @DisplayName("a line with no toppings is completely unchanged")
    void noToppingsIsUnchanged() {
        SaleResponse response = saleService.createSale(saleWith("1"));

        assertThat(response.getItems()).hasSize(1);
        assertThat(response.getTotalAmount()).isEqualByComparingTo("1000.00");
        assertThat(response.getItems().get(0).getToppingId()).isNull();
    }

    @Test
    @DisplayName("VAT-inclusive mode extracts tax from the topping too")
    void inclusiveModeExtractsFromToppings() {
        when(tenantInfoService.isTaxInclusive(TestUtils.TEST_TENANT_ID)).thenReturn(true);

        SaleResponse response = saleService.createSale(
                saleWith("1", topping(cheeseId, "1", null)));

        // Inclusive 10%: dish 1000 -> 1000 - 909.09 = 90.91; cheese 120 -> 120 - 109.09 = 10.91.
        assertThat(lineNamed(response, "Margherita").getTaxAmount()).isEqualByComparingTo("90.91");
        assertThat(lineNamed(response, "Extra cheese").getTaxAmount()).isEqualByComparingTo("10.91");
        // Customer pays the marked price either way.
        assertThat(response.getNetAmount()).isEqualByComparingTo("1120.00");
    }
}
