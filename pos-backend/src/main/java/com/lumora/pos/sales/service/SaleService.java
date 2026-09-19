package com.lumora.pos.sales.service;

import com.lumora.pos.audit.AuditAction;
import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.cashsession.entity.CashSessionEntity;
import com.lumora.pos.cashsession.repository.CashSessionRepository;
import com.lumora.pos.cashsession.service.CashSessionService;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.credit.service.CreditService;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.loyalty.dto.LoyaltyConfig;
import com.lumora.pos.loyalty.service.LoyaltyService;
import com.lumora.pos.sales.dto.PaymentCorrectionRequest;
import com.lumora.pos.sales.dto.SaleRequest;
import com.lumora.pos.sales.dto.SaleResponse;
import com.lumora.pos.sales.dto.SalesSummaryResponse;
import com.lumora.pos.sales.entity.SaleEntity;
import com.lumora.pos.sales.entity.SaleItemEntity;
import com.lumora.pos.sales.repository.SaleRepository;
import com.lumora.pos.tenant.TenantContext;
import com.lumora.pos.tenant.service.TenantInfoService;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import com.lumora.pos.auth.entity.RoleEntity;
import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.customer.entity.CustomerEntity;
import com.lumora.pos.customer.repository.CustomerRepository;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.inventory.repository.StockLevelRepository;
import com.lumora.pos.tax.service.TaxRateService;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.inventory.entity.StockLevelEntity;

@Service
@RequiredArgsConstructor
public class SaleService {

    private final SaleRepository saleRepository;
    private final ProductRepository productRepository;
    private final CustomerRepository customerRepository;
    private final UserRepository userRepository;
    private final BranchRepository branchRepository;
    private final BranchAccessGuard branchAccessGuard;
    private final StockLevelRepository stockLevelRepository;
    private final AuditService auditService;
    private final TaxRateService taxRateService;
    private final CashSessionService cashSessionService;
    private final CashSessionRepository cashSessionRepository;
    private final PasswordEncoder passwordEncoder;
    private final LoyaltyService loyaltyService;
    private final TenantInfoService tenantInfoService;
    private final CreditService creditService;

    /** Window during which a cashier may self-correct their own last sale
     *  without a manager PIN. Sales older than this — or sales rung by
     *  another cashier — require a MANAGER/ADMIN PIN. */
    static final Duration CASHIER_SELF_SERVE_WINDOW = Duration.ofMinutes(5);

    /** Store calendar zone. Timestamps are stored as UTC wall-clock, so any
     *  "today"/day-boundary logic must resolve the date in this zone (not the
     *  server zone, which is UTC in containers) and map the window back to UTC. */
    private static final ZoneId STORE_ZONE = ZoneId.of("Asia/Colombo");

        /**
         * Creates a sale and persists it in the current tenant's context.
         *
         * <p><b>@CreatedBy assumption:</b> Spring Data's {@link org.springframework.data.annotation.CreatedBy}
         * annotation (via {@code AuditingEntityListener}) populates {@code createdBy} from
         * {@code SecurityContextHolder}. This works correctly for web requests but will leave
         * {@code createdBy = null} for any code path that enters this service outside of a
         * servlet context — e.g. scheduled jobs, batch imports, or test fixtures that don't
         * set up a {@link org.springframework.security.core.context.SecurityContext}.
         * If {@code createdBy} must never be null, add {@code nullable = false} to the
         * {@code @Column} on {@code SaleEntity} so failures are loud rather than silent.
         */
        @Transactional
        public SaleResponse createSale(SaleRequest request) {
                UUID tenantId = TenantContext.getTenantId();

                SaleEntity sale = new SaleEntity();
                sale.setTenantId(tenantId);
                sale.setInvoiceNumber("INV-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());

                // Resolve the acting user once — used for cash-session linkage and the
                // primary-branch fallback below.
                UUID currentUserId = null;
                Authentication auth = SecurityContextHolder.getContext().getAuthentication();
                if (auth != null && auth.getName() != null) {
                        try {
                                currentUserId = UUID.fromString(auth.getName());
                        } catch (IllegalArgumentException ignored) {
                                // auth.getName() wasn't a UUID (e.g. system call); leave null.
                        }
                }

                // Tag the sale with the cashier's active cash session, if any. Historical
                // or back-office sales made without an open drawer remain unlinked (null).
                Optional<CashSessionEntity> activeSession = currentUserId == null
                                ? Optional.empty()
                                : cashSessionService.findActiveEntityByUserId(currentUserId);
                activeSession.ifPresent(session -> sale.setCashSessionId(session.getId()));

                // Resolve Branch (Location). Explicit branchId wins; otherwise fall back to the
                // acting user's primary branch, then the tenant default (back-office / no-branch users).
                BranchEntity branch;
                if (request.getBranchId() != null) {
                        branch = branchRepository.findByIdAndTenantId(request.getBranchId(), tenantId)
                                        .orElseThrow(() -> new BusinessException(
                                                        "Branch not found: " + request.getBranchId()));
                } else {
                        UUID primaryBranchId = currentUserId == null ? null
                                        : userRepository.findById(currentUserId)
                                                        .map(u -> u.getPrimaryBranch() == null ? null : u.getPrimaryBranch().getId())
                                                        .orElse(null);
                        if (primaryBranchId != null) {
                                branch = branchRepository.findByIdAndTenantId(primaryBranchId, tenantId)
                                                .orElseThrow(() -> new BusinessException("Primary branch not found"));
                        } else {
                                branch = branchRepository.findByIsDefaultTrueAndTenantId(tenantId)
                                                .orElseThrow(() -> new BusinessException(
                                                                "Default branch not found and no branchId provided"));
                        }
                }

                // Enforce branch access — no-op when restrictions are off or the caller is an admin.
                branchAccessGuard.assertCanAccess(branch.getId());

                // A drawer can't span branches: a sale must be rung at the open session's branch.
                if (activeSession.isPresent() && activeSession.get().getBranch() != null
                                && !activeSession.get().getBranch().getId().equals(branch.getId())) {
                        throw new BusinessException(
                                        "This sale's branch doesn't match your open cash drawer. End your shift to switch branches.");
                }
                final UUID finalBranchId = branch.getId();
                sale.setBranch(branch);

                CustomerEntity customer = null;
                if (request.getCustomerId() != null) {
                        customer = customerRepository.findByIdAndTenantId(request.getCustomerId(), tenantId)
                                        .orElseThrow(() -> new BusinessException("Customer not found"));
                        sale.setCustomer(customer);
                }

                sale.setPaymentMethod(SaleEntity.PaymentMethod.valueOf(request.getPaymentMethod().toUpperCase()));

                // CREDIT ("on account") sales are fulfilled now but not paid — the amount
                // is charged to the customer's store-credit balance (validated against
                // their limit after totals are known). They stay PENDING; accounts
                // receivable is tracked at the customer-balance level, not per sale.
                boolean creditSale = sale.getPaymentMethod() == SaleEntity.PaymentMethod.CREDIT;
                if (creditSale) {
                        if (customer == null) {
                                throw new BusinessException("Credit sales require a customer to be attached");
                        }
                        creditService.assertEnabled(tenantId);
                        sale.setPaymentStatus(SaleEntity.PaymentStatus.PENDING);
                } else {
                        sale.setPaymentStatus(SaleEntity.PaymentStatus.PAID);
                }

                // Pricing mode is resolved once and stamped on the sale so reprints
                // stay faithful if the tenant later flips it. Inclusive (LK default):
                // shelf prices contain VAT, which is extracted for the invoice.
                boolean taxInclusive = tenantInfoService.isTaxInclusive(tenantId);
                sale.setTaxInclusive(taxInclusive);

                BigDecimal totalAmount = BigDecimal.ZERO;
                BigDecimal totalTax = BigDecimal.ZERO;
                BigDecimal totalDiscount = BigDecimal.ZERO;

                for (SaleRequest.SaleItemRequest itemReq : request.getItems()) {
                        SaleItemEntity item = new SaleItemEntity();
                        item.setSale(sale);
                        item.setTenantId(tenantId);

                        // A line is either a catalog product (productId set) or a custom/open
                        // line (productId null, itemName set). Custom lines are NOT in the
                        // catalog: no active check, no stock deduction, no COGS.
                        boolean custom = itemReq.getProductId() == null;
                        String lineLabel;
                        BigDecimal taxRate;
                        // Unit price is authoritative server-side for catalog lines: it comes
                        // from the product, never the request, so a tampered client can't
                        // under-ring a catalogued item. Custom/open lines have no catalog
                        // entry, so their typed price stands.
                        BigDecimal unitPrice;

                        if (custom) {
                                if (itemReq.getItemName() == null || itemReq.getItemName().isBlank()) {
                                        throw new BusinessException("A custom line item requires a name");
                                }
                                lineLabel = itemReq.getItemName().trim();
                                item.setProductId(null);
                                item.setItemName(lineLabel);
                                taxRate = taxRateService.getDefaultRate(tenantId);
                                unitPrice = itemReq.getUnitPrice();
                        } else {
                                ProductEntity product = productRepository.findByIdAndTenantId(itemReq.getProductId(), tenantId)
                                                .orElseThrow(() -> new BusinessException(
                                                                "Product not found: " + itemReq.getProductId()));

                                if (!product.isActive()) {
                                        throw new BusinessException("Product " + product.getName() + " is inactive and cannot be sold.");
                                }

                                // Stock is integer; reject fractional quantity until fractional stock
                                // is properly modelled. Without this, .intValue() truncation silently
                                // deducts the wrong amount.
                                if (itemReq.getQuantity().stripTrailingZeros().scale() > 0) {
                                        throw new BusinessException(
                                                        "Fractional quantities are not supported for product: " + product.getName());
                                }
                                int qty = itemReq.getQuantity().intValueExact();

                                // Branch-specific Stock Check & Deduction (Pessimistic Lock)
                                StockLevelEntity stockLevel = stockLevelRepository
                                                .findByProductAndBranchForUpdate(product.getId(), finalBranchId, tenantId)
                                                .orElseThrow(() -> new BusinessException(
                                                                "Stock record not found for product: " + product.getName()
                                                                                + " in the selected branch"));

                                if (stockLevel.getQuantity() < qty) {
                                        throw new BusinessException(
                                                        "Insufficient stock for product: " + product.getName()
                                                                        + " in the selected branch");
                                }

                                // Deduct Stock from Branch
                                stockLevel.setQuantity(stockLevel.getQuantity() - qty);
                                stockLevelRepository.save(stockLevel);

                                lineLabel = product.getName();
                                item.setProductId(product.getId());
                                taxRate = taxRateService.getApplicableRate(product);
                                unitPrice = product.getBasePrice();
                        }

                        BigDecimal discount = itemReq.getDiscountAmount() != null
                                        ? itemReq.getDiscountAmount()
                                        : BigDecimal.ZERO;
                        BigDecimal subtotal = unitPrice.multiply(itemReq.getQuantity());
                        if (discount.compareTo(subtotal) > 0) {
                                throw new BusinessException(
                                                "Discount " + discount + " exceeds line subtotal " + subtotal
                                                                + " for " + lineLabel);
                        }

                        item.setQuantity(itemReq.getQuantity());
                        item.setUnitPrice(unitPrice);
                        item.setDiscountAmount(discount);

                        // Tax: per line, HALF_UP, scale 2. Two modes (stamped on the sale):
                        //  - INCLUSIVE: unitPrice already contains VAT. Extract it from the
                        //    discounted line — net = lineNet / (1 + rate), VAT = lineNet − net.
                        //    The customer pays the inclusive amount, so totalAmount = lineNet.
                        //  - EXCLUSIVE: VAT is added on top of the discounted line, so the
                        //    customer pays net + VAT.
                        // Either way taxAmount is the VAT and item totalAmount is what was paid.
                        BigDecimal lineNet = subtotal.subtract(discount);
                        BigDecimal itemTax;
                        BigDecimal lineTotal;
                        if (taxInclusive) {
                                BigDecimal exVat = lineNet.divide(
                                                BigDecimal.ONE.add(taxRate), 2, RoundingMode.HALF_UP);
                                itemTax = lineNet.subtract(exVat);
                                lineTotal = lineNet;
                        } else {
                                itemTax = lineNet.multiply(taxRate).setScale(2, RoundingMode.HALF_UP);
                                lineTotal = lineNet.add(itemTax);
                        }

                        item.setTaxAmount(itemTax);
                        item.setTotalAmount(lineTotal);

                        sale.getItems().add(item);

                        totalAmount = totalAmount.add(subtotal);
                        totalTax = totalTax.add(itemTax);
                        totalDiscount = totalDiscount.add(discount);
                }

                sale.setTotalAmount(totalAmount);
                sale.setTaxAmount(totalTax);
                sale.setDiscountAmount(totalDiscount);
                // Payable = what the customer hands over. Inclusive: VAT is already
                // inside the prices, so it's just subtotal − discount. Exclusive: add VAT.
                sale.setNetAmount(taxInclusive
                                ? totalAmount.subtract(totalDiscount)
                                : totalAmount.subtract(totalDiscount).add(totalTax));

                // Loyalty redemption — points spent reduce the bill like cash, applied
                // AFTER tax (a rebate, not a taxable discount). The client's requested
                // points are the ceiling; the value is recomputed here from the tenant's
                // configured point value and capped to both the balance and the bill so
                // a sale can never go negative. The actual points debit + ledger entry
                // happen after the sale is saved (we need the sale id).
                LoyaltyConfig loyalty = loyaltyService.getConfig();
                int pointsRedeemed = 0;
                BigDecimal loyaltyDiscount = BigDecimal.ZERO;
                if (customer != null && loyalty.isEnabled()
                                && request.getPointsToRedeem() != null && request.getPointsToRedeem() > 0) {
                        if (loyalty.getPointValue() == null || loyalty.getPointValue().signum() <= 0) {
                                throw new BusinessException("Point redemption is not enabled for this business");
                        }
                        int requested = request.getPointsToRedeem();
                        if (requested > customer.getLoyaltyPoints()) {
                                throw new BusinessException("Customer does not have enough points to redeem");
                        }
                        int maxByBill = sale.getNetAmount()
                                        .divide(loyalty.getPointValue(), 0, RoundingMode.DOWN).intValue();
                        pointsRedeemed = Math.min(requested, maxByBill);
                        loyaltyDiscount = loyalty.valueOfPoints(pointsRedeemed).min(sale.getNetAmount());
                        sale.setNetAmount(sale.getNetAmount().subtract(loyaltyDiscount));
                }
                sale.setLoyaltyPointsRedeemed(pointsRedeemed);
                sale.setLoyaltyDiscountAmount(loyaltyDiscount);

                // Determine cash tendered for drawer-variance accuracy.
                // CASH: always equals netAmount. The gross amount the customer hands over
                //   is UI-only — change is given back, only netAmount stays in the drawer.
                //   Storing the raw tendered amount inflates expectedBalance by the change.
                // SPLIT: client sends the cash portion; bounded to [0, netAmount].
                // CARD/ONLINE/CREDIT: no physical cash changes hands.
                BigDecimal cashTendered;
                // Gross cash the customer handed over — kept for the receipt's
                // Cash/Change lines. Null for non-cash methods.
                BigDecimal amountTendered = null;
                switch (sale.getPaymentMethod()) {
                        case CASH:
                                cashTendered = sale.getNetAmount();
                                // The client sends the actual gross handed over; if absent or
                                // short, treat it as an exact tender (gross == net, no change).
                                amountTendered = request.getCashTendered() != null
                                                && request.getCashTendered().compareTo(sale.getNetAmount()) > 0
                                                                ? request.getCashTendered()
                                                                : sale.getNetAmount();
                                break;
                        case SPLIT: {
                                BigDecimal cashPortion = request.getCashTendered() != null
                                                ? request.getCashTendered()
                                                : BigDecimal.ZERO;
                                if (cashPortion.signum() < 0
                                                || cashPortion.compareTo(sale.getNetAmount()) > 0) {
                                        throw new BusinessException(
                                                        "SPLIT cash portion must be between 0 and " + sale.getNetAmount());
                                }
                                cashTendered = cashPortion;
                                amountTendered = cashPortion;
                                break;
                        }
                        default:
                                cashTendered = BigDecimal.ZERO;
                }
                sale.setCashTendered(cashTendered);
                sale.setAmountTendered(amountTendered);

                SaleEntity savedSale = saleRepository.save(sale);

                // Charge a credit sale to the customer's account. Runs in this same
                // transaction, so an over-limit hard-block throws and rolls back the
                // whole sale (including the stock deduction above).
                if (creditSale) {
                        creditService.charge(customer, savedSale.getId(), savedSale.getNetAmount());
                }

                // Loyalty ledger — redeem first (debit the spent points), then earn on
                // the final amount paid. Both append a ledger row and keep the customer's
                // running balance in sync. Earn on a completed sale — PAID, or CREDIT
                // (the goods were delivered even though payment is on account).
                if (customer != null) {
                        if (pointsRedeemed > 0) {
                                loyaltyService.recordRedeem(customer, savedSale.getId(), pointsRedeemed,
                                                "Redeemed on sale " + savedSale.getInvoiceNumber());
                        }
                        if (savedSale.getPaymentStatus() == SaleEntity.PaymentStatus.PAID || creditSale) {
                                int earnedPoints = loyalty.pointsForSpend(savedSale.getNetAmount());
                                loyaltyService.recordEarn(customer, savedSale.getId(), earnedPoints);
                        }
                }

                SaleResponse response = mapToResponse(savedSale);

                // Audit: Record the completed sale with full response snapshot
                auditService.log(AuditAction.SALE_CREATE, "SALE", savedSale.getId(), null, response);

                return response;
        }

        /**
         * Corrects payment metadata on a completed sale: the recorded payment method
         * and/or cash tendered. Does <b>not</b> change items, totals, tax, stock, or
         * loyalty — those go through the Return flow.
         *
         * <p>Rules:
         * <ul>
         *   <li>Sale must be {@link SaleEntity.PaymentStatus#PAID}. Refunded or
         *       cancelled sales are immutable.</li>
         *   <li>Sale must be attached to an OPEN cash session. Sales from a
         *       closed shift must be reversed via Returns.</li>
         *   <li>Cashier may self-correct their own sale within
         *       {@link #CASHIER_SELF_SERVE_WINDOW}. Otherwise a MANAGER or ADMIN
         *       PIN is required.</li>
         * </ul>
         *
         * <p>The cash-session reconciliation query sums {@code cash_tendered} live
         * from the sales table, so the corrected value automatically flows through
         * to end-of-shift variance — no compensating ledger entry is needed.
         */
        @Transactional
        public SaleResponse correctPayment(UUID saleId, PaymentCorrectionRequest request) {
                UUID tenantId = TenantContext.getTenantId();

                if ((request.getPaymentMethod() == null || request.getPaymentMethod().isBlank())
                                && request.getCashTendered() == null) {
                        throw new BusinessException("Provide paymentMethod, cashTendered, or both");
                }

                SaleEntity sale = saleRepository.findByIdAndTenantId(saleId, tenantId)
                                .orElseThrow(() -> new BusinessException("Sale not found: " + saleId));

                if (sale.getPaymentStatus() != SaleEntity.PaymentStatus.PAID) {
                        throw new BusinessException(
                                        "Only PAID sales can be corrected. Current status: " + sale.getPaymentStatus());
                }

                if (sale.getCashSessionId() == null) {
                        throw new BusinessException(
                                        "Sale is not attached to a cash session. Use a Refund instead.");
                }
                CashSessionEntity session = cashSessionRepository
                                .findByIdAndTenantId(sale.getCashSessionId(), tenantId)
                                .orElseThrow(() -> new BusinessException("Cash session for this sale was not found"));
                if (session.getStatus() != CashSessionEntity.Status.OPEN) {
                        throw new BusinessException(
                                        "The shift this sale belongs to has been closed. Use a Refund instead.");
                }

                UUID currentUserId = currentUserId();
                boolean ownSale = currentUserId != null && currentUserId.equals(sale.getCreatedBy());
                boolean withinWindow = sale.getCreatedAt() != null
                                && Duration.between(sale.getCreatedAt(), LocalDateTime.now())
                                                .compareTo(CASHIER_SELF_SERVE_WINDOW) <= 0;

                if (!(ownSale && withinWindow)) {
                        String pin = request.getManagerPin();
                        if (pin == null || pin.isBlank()) {
                                throw new BusinessException("Manager PIN is required to correct this sale");
                        }
                        if (!verifyManagerPin(tenantId, pin)) {
                                throw new BusinessException("Invalid manager PIN");
                        }
                }

                SaleResponse before = mapToResponse(sale);

                if (request.getPaymentMethod() != null && !request.getPaymentMethod().isBlank()) {
                        SaleEntity.PaymentMethod newMethod;
                        try {
                                newMethod = SaleEntity.PaymentMethod
                                                .valueOf(request.getPaymentMethod().toUpperCase());
                        } catch (IllegalArgumentException ex) {
                                throw new BusinessException("Unknown payment method: " + request.getPaymentMethod());
                        }
                        sale.setPaymentMethod(newMethod);

                        // Re-derive cash_tendered for the new method unless the caller
                        // also supplied an explicit override below. Mirrors createSale.
                        if (request.getCashTendered() == null) {
                                switch (newMethod) {
                                        case CASH:
                                                sale.setCashTendered(sale.getNetAmount());
                                                // No fresh gross supplied → assume an exact tender.
                                                sale.setAmountTendered(sale.getNetAmount());
                                                break;
                                        case CARD:
                                        case ONLINE:
                                        case CREDIT:
                                                sale.setCashTendered(BigDecimal.ZERO);
                                                sale.setAmountTendered(null);
                                                break;
                                        case SPLIT:
                                                // Switching to SPLIT without a fresh cash portion
                                                // is ambiguous; leave the existing value and require
                                                // a follow-up call with cashTendered.
                                                break;
                                }
                        }
                }

                if (request.getCashTendered() != null) {
                        BigDecimal newTender = request.getCashTendered();
                        switch (sale.getPaymentMethod()) {
                                case CASH:
                                        if (newTender.compareTo(sale.getNetAmount()) < 0) {
                                                throw new BusinessException(
                                                                "CASH tender must be at least the sale net amount "
                                                                                + sale.getNetAmount());
                                        }
                                        // cashTendered stays at net for drawer math; the gross the
                                        // customer handed over is preserved on amountTendered so the
                                        // corrected receipt shows the right Cash/Change figures.
                                        sale.setCashTendered(sale.getNetAmount());
                                        sale.setAmountTendered(newTender);
                                        break;
                                case SPLIT:
                                        if (newTender.signum() < 0
                                                        || newTender.compareTo(sale.getNetAmount()) > 0) {
                                                throw new BusinessException(
                                                                "SPLIT cash portion must be between 0 and "
                                                                                + sale.getNetAmount());
                                        }
                                        sale.setCashTendered(newTender);
                                        sale.setAmountTendered(newTender);
                                        break;
                                case CARD:
                                case ONLINE:
                                case CREDIT:
                                        sale.setCashTendered(BigDecimal.ZERO);
                                        sale.setAmountTendered(null);
                                        break;
                        }
                }

                SaleEntity saved = saleRepository.save(sale);
                SaleResponse after = mapToResponse(saved);

                auditService.log(AuditAction.SALE_PAYMENT_CORRECT, "SALE", saved.getId(), before, after);

                return after;
        }

        private UUID currentUserId() {
                Authentication auth = SecurityContextHolder.getContext().getAuthentication();
                if (auth == null || auth.getPrincipal() == null) return null;
                if (auth.getPrincipal() instanceof UUID uuid) return uuid;
                try {
                        return UUID.fromString(auth.getName());
                } catch (IllegalArgumentException ex) {
                        return null;
                }
        }

        /**
         * Validates a plaintext PIN against every active MANAGER/ADMIN user in the
         * tenant. Iterates the full list without short-circuit so response time is
         * constant regardless of which (if any) PIN matched — same constant-time
         * pattern used by {@code AuthService.pinLogin}.
         */
        private boolean verifyManagerPin(UUID tenantId, String pin) {
                List<UserEntity> candidates = userRepository.findActiveUsersWithPinByTenantId(tenantId);
                boolean matched = false;
                for (UserEntity user : candidates) {
                        boolean pinMatches = passwordEncoder.matches(pin, user.getPin());
                        boolean hasManagerRole = user.getRoles().stream()
                                        .map(RoleEntity::getName)
                                        .anyMatch(n -> "MANAGER".equalsIgnoreCase(n) || "ADMIN".equalsIgnoreCase(n));
                        if (pinMatches && hasManagerRole && !matched) {
                                matched = true;
                        }
                }
                return matched;
        }

        /**
         * Sales rung up during the current cashier's OPEN cash session, newest
         * first — the candidate list for the terminal's payment-correction picker.
         * Returns an empty list when the cashier has no open session.
         */
        @Transactional(readOnly = true)
        public List<SaleResponse> getCurrentSessionSales() {
                UUID tenantId = TenantContext.getTenantId();
                UUID userId = currentUserId();
                if (userId == null) {
                        return List.of();
                }
                return cashSessionService.findActiveEntityByUserId(userId)
                                .map(session -> saleRepository
                                                .findByCashSessionIdAndTenantId(session.getId(), tenantId)
                                                .stream()
                                                .map(this::mapToResponse)
                                                .collect(Collectors.toList()))
                                .orElseGet(List::of);
        }

        @Transactional(readOnly = true)
        public SaleResponse getSaleById(UUID id) {
                return saleRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                                .map(this::mapToResponse)
                                .orElseThrow(() -> new BusinessException("Sale not found"));
        }

        @Transactional(readOnly = true)
        public org.springframework.data.domain.Page<SaleResponse> getSalesByCustomer(UUID customerId, org.springframework.data.domain.Pageable pageable) {
                UUID tenantId = TenantContext.getTenantId();
                return saleRepository.findByCustomerIdAndTenantIdOrderByCreatedAtDesc(customerId, tenantId, pageable)
                        .map(this::mapToResponse);
        }

        @Transactional(readOnly = true)
        public SalesSummaryResponse getDailySummary() {
                UUID tenantId = TenantContext.getTenantId();
                // "Today" is the store's calendar day (Asia/Colombo), mapped to the UTC
                // wall-clock window the timestamps are stored in. Using the server-zone
                // date (UTC in containers) would roll the day over at 05:30 local time.
                LocalDate today = LocalDate.now(STORE_ZONE);
                LocalDateTime startOfDay = today.atStartOfDay(STORE_ZONE)
                                .withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();
                LocalDateTime endOfDay = today.atTime(LocalTime.MAX).atZone(STORE_ZONE)
                                .withZoneSameInstant(ZoneOffset.UTC).toLocalDateTime();

                List<Object[]> summaryData = saleRepository.aggregateDailySummary(tenantId, startOfDay, endOfDay);

                long totalOrders = 0;
                BigDecimal totalGross = BigDecimal.ZERO;
                BigDecimal totalTax = BigDecimal.ZERO;
                BigDecimal totalDiscount = BigDecimal.ZERO;
                BigDecimal totalNet = BigDecimal.ZERO;
                Map<String, BigDecimal> paymentBreakdown = new HashMap<>();

                for (Object[] row : summaryData) {
                        // row[0] = paymentMethod (SaleEntity.PaymentMethod)
                        // row[1] = count (Long)
                        // row[2] = sumGross (BigDecimal)
                        // row[3] = sumTax (BigDecimal)
                        // row[4] = sumDiscount (BigDecimal)
                        // row[5] = sumNet (BigDecimal)

                        String method = row[0] != null ? ((SaleEntity.PaymentMethod) row[0]).name() : "UNKNOWN";
                        long count = row[1] != null ? (Long) row[1] : 0L;
                        BigDecimal gross = (BigDecimal) row[2] != null ? (BigDecimal) row[2] : BigDecimal.ZERO;
                        BigDecimal tax = (BigDecimal) row[3] != null ? (BigDecimal) row[3] : BigDecimal.ZERO;
                        BigDecimal discount = (BigDecimal) row[4] != null ? (BigDecimal) row[4] : BigDecimal.ZERO;
                        BigDecimal net = (BigDecimal) row[5] != null ? (BigDecimal) row[5] : BigDecimal.ZERO;

                        totalOrders += count;
                        totalGross = totalGross.add(gross);
                        totalTax = totalTax.add(tax);
                        totalDiscount = totalDiscount.add(discount);
                        totalNet = totalNet.add(net);

                        paymentBreakdown.put(method, net);
                }

                return SalesSummaryResponse.builder()
                                .totalOrders((int) totalOrders)
                                .totalGrossSales(totalGross)
                                .totalTax(totalTax)
                                .totalDiscounts(totalDiscount)
                                .totalNetSales(totalNet)
                                .salesByPaymentMethod(paymentBreakdown)
                                .build();
        }

        private SaleResponse mapToResponse(SaleEntity sale) {
                // Batch-fetch all product names in ONE query (fixes N+1).
                // Custom lines have a null productId — exclude them from the lookup.
                Set<UUID> productIds = sale.getItems().stream()
                                .map(SaleItemEntity::getProductId)
                                .filter(java.util.Objects::nonNull)
                                .collect(Collectors.toSet());

                Map<UUID, String> productNameMap = productRepository.findAllById(productIds).stream()
                                .collect(Collectors.toMap(ProductEntity::getId, ProductEntity::getName));

                String cashierName = "Unknown Worker";
                if (sale.getCreatedBy() != null) {
                        cashierName = userRepository.findById(sale.getCreatedBy())
                                        .map(user -> user.getFirstName() + " " + user.getLastName())
                                        .orElse("Unknown Cashier");
                }

                UUID customerId = null;
                String customerName = null;
                Integer earnedPoints = null;
                Integer loyaltyBalance = null;

                if (sale.getCustomer() != null) {
                        customerId = sale.getCustomer().getId();
                        customerName = sale.getCustomer().getFirstName() + " " + sale.getCustomer().getLastName();
                        loyaltyBalance = sale.getCustomer().getLoyaltyPoints();
                        // Points are earned on completed sales: PAID or CREDIT (on account).
                        if (sale.getPaymentStatus() == SaleEntity.PaymentStatus.PAID
                                        || sale.getPaymentMethod() == SaleEntity.PaymentMethod.CREDIT) {
                                earnedPoints = loyaltyService.getConfig().pointsForSpend(sale.getNetAmount());
                        } else {
                                earnedPoints = 0;
                        }
                }

                // Gross handed over + change given back, for the receipt. Falls back
                // to net (exact tender, no change) for legacy rows with no stored gross.
                BigDecimal amountTendered = sale.getAmountTendered();
                BigDecimal changeDue = amountTendered != null
                                ? amountTendered.subtract(sale.getNetAmount()).max(BigDecimal.ZERO)
                                : BigDecimal.ZERO;

                return SaleResponse.builder()
                                .id(sale.getId())
                                .invoiceNumber(sale.getInvoiceNumber())
                                .totalAmount(sale.getTotalAmount())
                                .taxAmount(sale.getTaxAmount())
                                .discountAmount(sale.getDiscountAmount())
                                .netAmount(sale.getNetAmount())
                                .paymentStatus(sale.getPaymentStatus().name())
                                .paymentMethod(sale.getPaymentMethod().name())
                                .amountTendered(amountTendered)
                                .changeDue(changeDue)
                                .createdAt(sale.getCreatedAt())
                                .cashierName(cashierName)
                                .customerId(customerId)
                                .customerName(customerName)
                                .earnedPoints(earnedPoints)
                                .loyaltyBalance(loyaltyBalance)
                                .pointsRedeemed(sale.getLoyaltyPointsRedeemed())
                                .loyaltyDiscountAmount(sale.getLoyaltyDiscountAmount())
                                .taxInclusive(sale.isTaxInclusive())
                                .items(sale.getItems().stream()
                                                .map(item -> mapItemToResponse(item, productNameMap))
                                                .collect(Collectors.toList()))
                                .build();
        }

        private SaleResponse.SaleItemResponse mapItemToResponse(SaleItemEntity item,
                        Map<UUID, String> productNameMap) {
                String productName = item.getProductId() != null
                                ? productNameMap.getOrDefault(item.getProductId(), "Unknown Product")
                                : (item.getItemName() != null && !item.getItemName().isBlank()
                                                ? item.getItemName() : "Custom item");

                return SaleResponse.SaleItemResponse.builder()
                                .id(item.getId())
                                .productId(item.getProductId())
                                .productName(productName)
                                .quantity(item.getQuantity())
                                .unitPrice(item.getUnitPrice())
                                .discountAmount(item.getDiscountAmount())
                                .taxAmount(item.getTaxAmount())
                                .totalAmount(item.getTotalAmount())
                                .build();
        }
}
