package com.lumora.pos.credit.service;

import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.cashsession.dto.CashSessionDtos.CashSessionResponse;
import com.lumora.pos.cashsession.dto.CashSessionDtos.EndShiftRequest;
import com.lumora.pos.cashsession.dto.CashSessionDtos.StartShiftRequest;
import com.lumora.pos.cashsession.service.CashSessionService;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.credit.dto.RepaymentRequest;
import com.lumora.pos.credit.entity.CreditTransactionEntity;
import com.lumora.pos.credit.repository.CreditTransactionRepository;
import com.lumora.pos.customer.entity.CustomerEntity;
import com.lumora.pos.customer.repository.CustomerRepository;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.entity.StockLevelEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.repository.StockLevelRepository;
import com.lumora.pos.sales.dto.SaleRequest;
import com.lumora.pos.sales.dto.SaleResponse;
import com.lumora.pos.sales.service.SaleService;
import com.lumora.pos.superadmin.entity.TenantConfigurationEntity;
import com.lumora.pos.superadmin.repository.TenantConfigurationRepository;
import com.lumora.pos.tax.entity.TaxRateEntity;
import com.lumora.pos.tax.repository.TaxRateRepository;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.CacheManager;
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
 * Coverage for the store-credit money path: charging a credit sale to a
 * customer's account (with the over-limit hard block), recording repayments,
 * and cash repayments flowing into the open drawer's expected balance.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class CreditServiceIntegrationTest {

    @Autowired private CreditService creditService;
    @Autowired private SaleService saleService;
    @Autowired private CashSessionService cashSessionService;
    @Autowired private CreditTransactionRepository creditTransactionRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private BranchRepository branchRepository;
    @Autowired private ProductRepository productRepository;
    @Autowired private StockLevelRepository stockLevelRepository;
    @Autowired private TaxRateRepository taxRateRepository;
    @Autowired private TenantConfigurationRepository tenantConfigurationRepository;
    @Autowired(required = false) private CacheManager cacheManager;

    private UUID tenantId;
    private UserEntity cashier;
    private BranchEntity branch;
    private ProductEntity product;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);

        cashier = UserEntity.builder()
                .email("cashier-" + UUID.randomUUID() + "@test.local")
                .passwordHash("x")
                .firstName("Test")
                .lastName("Cashier")
                .isActive(true)
                .build();
        cashier.setTenantId(tenantId);
        cashier = userRepository.save(cashier);

        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(cashier.getId(), null, Collections.emptyList()));

        branch = BranchEntity.builder().name("Main").isDefault(true).isActive(true).build();
        branch.setTenantId(tenantId);
        branch = branchRepository.save(branch);

        TaxRateEntity zeroTax = TaxRateEntity.builder()
                .name("Zero").rate(BigDecimal.ZERO).isDefault(true).build();
        zeroTax.setTenantId(tenantId);
        taxRateRepository.save(zeroTax);

        product = ProductEntity.builder()
                .name("Coffee").sku("COF-1").basePrice(new BigDecimal("50.00"))
                .lowStockThreshold(1).isActive(true).build();
        product.setTenantId(tenantId);
        product = productRepository.save(product);

        StockLevelEntity stock = StockLevelEntity.builder()
                .product(product).branch(branch).quantity(100).build();
        stock.setTenantId(tenantId);
        stockLevelRepository.save(stock);

        // Grant the STORE_CREDIT feature to this tenant.
        setFeatureEnabled(true);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    @Test
    void creditSale_chargesAccount_incrementsBalanceAndWritesLedger() {
        CustomerEntity customer = saveCustomer(new BigDecimal("120.00"));

        SaleResponse sale = ringUpCreditSale(customer.getId());

        assertThat(sale.getPaymentStatus()).isEqualTo("PENDING");
        assertThat(sale.getPaymentMethod()).isEqualTo("CREDIT");

        CustomerEntity refreshed = customerRepository.findById(customer.getId()).orElseThrow();
        assertThat(refreshed.getCreditBalance()).isEqualByComparingTo("50.00");

        List<CreditTransactionEntity> ledger = creditTransactionRepository
                .findByCustomerIdAndTenantIdOrderByCreatedAtDesc(customer.getId(), tenantId, PageRequest.of(0, 10))
                .getContent();
        assertThat(ledger).hasSize(1);
        assertThat(ledger.get(0).getType()).isEqualTo(CreditTransactionEntity.Type.CHARGE);
        assertThat(ledger.get(0).getAmount()).isEqualByComparingTo("50.00");
        assertThat(ledger.get(0).getBalanceAfter()).isEqualByComparingTo("50.00");
    }

    @Test
    void creditSale_overLimit_isHardBlocked() {
        CustomerEntity customer = saveCustomer(new BigDecimal("40.00")); // one 50 sale already exceeds

        assertThatThrownBy(() -> ringUpCreditSale(customer.getId()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("available credit");
    }

    @Test
    void creditSale_withoutCustomer_isRejected() {
        SaleRequest req = creditSaleRequest(null);
        assertThatThrownBy(() -> saleService.createSale(req))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("require a customer");
    }

    @Test
    void creditSale_whenFeatureDisabled_isRejected() {
        setFeatureEnabled(false);
        CustomerEntity customer = saveCustomer(new BigDecimal("120.00"));

        assertThatThrownBy(() -> ringUpCreditSale(customer.getId()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("not enabled");
    }

    @Test
    void repayment_reducesBalance_writesLedgerAndFeedsDrawer() {
        CustomerEntity customer = saveCustomer(new BigDecimal("120.00"));

        // Open a drawer with $200 float, then ring a $50 credit sale (no cash moves).
        StartShiftRequest start = new StartShiftRequest();
        start.setOpeningBalance(new BigDecimal("200.00"));
        cashSessionService.startShift(cashier.getId(), start);
        ringUpCreditSale(customer.getId());

        // Customer pays back $30 in cash.
        RepaymentRequest repay = new RepaymentRequest();
        repay.setAmount(new BigDecimal("30.00"));
        repay.setPaymentMethod("CASH");
        creditService.recordRepayment(customer.getId(), repay);

        CustomerEntity refreshed = customerRepository.findById(customer.getId()).orElseThrow();
        assertThat(refreshed.getCreditBalance()).isEqualByComparingTo("20.00");

        // Closing counted at $230 (float + cash repayment) → variance $0.
        EndShiftRequest end = new EndShiftRequest();
        end.setClosingBalance(new BigDecimal("230.00"));
        CashSessionResponse closed = cashSessionService.endShift(cashier.getId(), end);

        assertThat(closed.getCashRepaymentsTotal()).isEqualByComparingTo("30.00");
        assertThat(closed.getExpectedBalance()).isEqualByComparingTo("230.00");
        assertThat(closed.getVariance()).isEqualByComparingTo("0.00");
    }

    @Test
    void repayment_exceedingBalance_isRejected() {
        CustomerEntity customer = saveCustomer(new BigDecimal("120.00"));
        ringUpCreditSale(customer.getId()); // balance now 50

        RepaymentRequest repay = new RepaymentRequest();
        repay.setAmount(new BigDecimal("80.00"));
        repay.setPaymentMethod("CASH");

        assertThatThrownBy(() -> creditService.recordRepayment(customer.getId(), repay))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("exceeds the outstanding balance");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private CustomerEntity saveCustomer(BigDecimal creditLimit) {
        CustomerEntity customer = CustomerEntity.builder()
                .firstName("Cred").lastName("Customer")
                .creditLimit(creditLimit).creditBalance(BigDecimal.ZERO)
                .build();
        customer.setTenantId(tenantId);
        return customerRepository.save(customer);
    }

    private SaleResponse ringUpCreditSale(UUID customerId) {
        return saleService.createSale(creditSaleRequest(customerId));
    }

    private SaleRequest creditSaleRequest(UUID customerId) {
        SaleRequest.SaleItemRequest item = new SaleRequest.SaleItemRequest();
        item.setProductId(product.getId());
        item.setQuantity(BigDecimal.ONE);
        item.setUnitPrice(new BigDecimal("50.00"));
        item.setDiscountAmount(BigDecimal.ZERO);

        return SaleRequest.builder()
                .customerId(customerId)
                .branchId(branch.getId())
                .paymentMethod("CREDIT")
                .items(List.of(item))
                .build();
    }

    private void setFeatureEnabled(boolean enabled) {
        TenantConfigurationEntity config = tenantConfigurationRepository.findByTenantId(tenantId)
                .orElseGet(() -> TenantConfigurationEntity.builder().tenantId(tenantId).build());
        config.setFeaturesEnabled(enabled
                ? List.of("SALES", "STORE_CREDIT")
                : List.of("SALES"));
        tenantConfigurationRepository.save(config);
        // findByTenantId is @Cacheable — drop any cached entry so the change is seen.
        if (cacheManager != null && cacheManager.getCache("tenantConfigs") != null) {
            cacheManager.getCache("tenantConfigs").evict(tenantId);
        }
    }
}
