package com.lumora.pos.credit.service;

import com.lumora.pos.cashsession.service.CashSessionService;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.credit.dto.CreditSummaryResponse;
import com.lumora.pos.credit.dto.CreditTransactionResponse;
import com.lumora.pos.credit.dto.RepaymentRequest;
import com.lumora.pos.credit.entity.CreditTransactionEntity;
import com.lumora.pos.credit.repository.CreditTransactionRepository;
import com.lumora.pos.customer.entity.CustomerEntity;
import com.lumora.pos.customer.repository.CustomerRepository;
import com.lumora.pos.superadmin.repository.TenantConfigurationRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Owns the customer store-credit ledger: gating the feature, charging credit
 * sales to a customer's account (with a hard over-limit block), recording
 * repayments, and keeping {@code customers.credit_balance} and the append-only
 * {@link CreditTransactionEntity} history in lock-step.
 *
 * <p>{@link #charge} mutates the {@link CustomerEntity} passed in by the sale
 * transaction and runs inside it, so an over-limit throw rolls the whole sale
 * back. Mirrors {@code LoyaltyService}.
 */
@Service
@RequiredArgsConstructor
public class CreditService {

    /** Feature tag that must be enabled on the tenant for any credit use. */
    public static final String FEATURE = "STORE_CREDIT";

    private final CreditTransactionRepository ledgerRepository;
    private final CustomerRepository customerRepository;
    private final TenantConfigurationRepository tenantConfigurationRepository;
    private final CashSessionService cashSessionService;

    /** True when the tenant's subscription has the store-credit feature enabled. */
    @Transactional(readOnly = true)
    public boolean isEnabled(UUID tenantId) {
        return tenantConfigurationRepository.findByTenantId(tenantId)
                .map(cfg -> cfg.hasFeature(FEATURE))
                .orElse(false);
    }

    /** Guards a credit operation; throws when the feature isn't enabled for the tenant. */
    public void assertEnabled(UUID tenantId) {
        if (!isEnabled(tenantId)) {
            throw new BusinessException("Store credit is not enabled for this business");
        }
    }

    /**
     * Charges a completed credit sale to the customer's account. Called from the
     * sale transaction after the sale is saved.
     *
     * <p>Hard block: if the charge would push the outstanding balance past the
     * customer's credit limit, throws — rolling back the sale (and its stock
     * deduction) because we run inside the caller's transaction.
     */
    @Transactional
    public void charge(CustomerEntity customer, UUID saleId, BigDecimal amount) {
        if (customer == null) {
            throw new BusinessException("Credit sales require a customer");
        }
        assertEnabled(TenantContext.getTenantId());
        if (amount == null || amount.signum() <= 0) {
            throw new BusinessException("Credit charge amount must be positive");
        }

        BigDecimal limit = customer.getCreditLimit() != null ? customer.getCreditLimit() : BigDecimal.ZERO;
        BigDecimal balance = customer.getCreditBalance() != null ? customer.getCreditBalance() : BigDecimal.ZERO;
        BigDecimal newBalance = balance.add(amount);

        if (newBalance.compareTo(limit) > 0) {
            BigDecimal available = limit.subtract(balance).max(BigDecimal.ZERO);
            throw new BusinessException(
                    "This sale exceeds the customer's available credit. Available: " + available
                            + ", required: " + amount);
        }

        customer.setCreditBalance(newBalance);
        customerRepository.save(customer);
        appendLedger(customer.getId(), saleId, CreditTransactionEntity.Type.CHARGE, amount, newBalance,
                null, null, "Credit sale");
    }

    /**
     * Records a customer paying down their credit balance. A CASH repayment is
     * stamped with the caller's open drawer so it flows into shift reconciliation.
     */
    @Transactional
    public CreditSummaryResponse recordRepayment(UUID customerId, RepaymentRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        assertEnabled(tenantId);

        CustomerEntity customer = customerRepository.findByIdAndTenantId(customerId, tenantId)
                .orElseThrow(() -> new BusinessException("Customer not found"));

        BigDecimal amount = request.getAmount();
        BigDecimal balance = customer.getCreditBalance() != null ? customer.getCreditBalance() : BigDecimal.ZERO;
        if (amount == null || amount.signum() <= 0) {
            throw new BusinessException("Repayment amount must be positive");
        }
        if (amount.compareTo(balance) > 0) {
            throw new BusinessException(
                    "Repayment " + amount + " exceeds the outstanding balance " + balance);
        }

        String method = request.getPaymentMethod().toUpperCase();
        UUID cashSessionId = null;
        if ("CASH".equals(method)) {
            UUID userId = currentUserId();
            if (userId != null) {
                cashSessionId = cashSessionService.findActiveEntityByUserId(userId)
                        .map(session -> session.getId())
                        .orElse(null);
            }
        }

        BigDecimal newBalance = balance.subtract(amount);
        customer.setCreditBalance(newBalance);
        customerRepository.save(customer);

        String description = request.getDescription() != null && !request.getDescription().isBlank()
                ? request.getDescription()
                : "Repayment (" + method + ")";
        appendLedger(customer.getId(), null, CreditTransactionEntity.Type.REPAYMENT,
                amount.negate(), newBalance, method, cashSessionId, description);

        return toSummary(customer);
    }

    @Transactional(readOnly = true)
    public CreditSummaryResponse getSummary(UUID customerId) {
        UUID tenantId = TenantContext.getTenantId();
        CustomerEntity customer = customerRepository.findByIdAndTenantId(customerId, tenantId)
                .orElseThrow(() -> new BusinessException("Customer not found"));
        return toSummary(customer);
    }

    @Transactional(readOnly = true)
    public Page<CreditTransactionResponse> getLedger(UUID customerId, Pageable pageable) {
        UUID tenantId = TenantContext.getTenantId();
        return ledgerRepository
                .findByCustomerIdAndTenantIdOrderByCreatedAtDesc(customerId, tenantId, pageable)
                .map(this::toResponse);
    }

    private CreditSummaryResponse toSummary(CustomerEntity customer) {
        BigDecimal limit = customer.getCreditLimit() != null ? customer.getCreditLimit() : BigDecimal.ZERO;
        BigDecimal balance = customer.getCreditBalance() != null ? customer.getCreditBalance() : BigDecimal.ZERO;
        return CreditSummaryResponse.builder()
                .customerId(customer.getId())
                .creditLimit(limit)
                .creditBalance(balance)
                .availableCredit(limit.subtract(balance).max(BigDecimal.ZERO))
                .build();
    }

    private void appendLedger(UUID customerId, UUID saleId, CreditTransactionEntity.Type type,
                              BigDecimal amount, BigDecimal balanceAfter, String paymentMethod,
                              UUID cashSessionId, String description) {
        CreditTransactionEntity tx = new CreditTransactionEntity();
        tx.setTenantId(TenantContext.getTenantId());
        tx.setCustomerId(customerId);
        tx.setSaleId(saleId);
        tx.setType(type);
        tx.setAmount(amount);
        tx.setBalanceAfter(balanceAfter);
        tx.setPaymentMethod(paymentMethod);
        tx.setCashSessionId(cashSessionId);
        tx.setDescription(description);
        ledgerRepository.save(tx);
    }

    private CreditTransactionResponse toResponse(CreditTransactionEntity tx) {
        return CreditTransactionResponse.builder()
                .id(tx.getId())
                .type(tx.getType().name())
                .amount(tx.getAmount())
                .balanceAfter(tx.getBalanceAfter())
                .paymentMethod(tx.getPaymentMethod())
                .description(tx.getDescription())
                .saleId(tx.getSaleId())
                .createdAt(tx.getCreatedAt())
                .build();
    }

    private UUID currentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth.getName() == null) return null;
        try {
            return UUID.fromString(auth.getName());
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }
}
