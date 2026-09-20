package com.lumora.pos.returns.service;

import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.entity.InventoryAdjustmentEntity;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.entity.StockLevelEntity;
import com.lumora.pos.inventory.repository.InventoryAdjustmentRepository;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.repository.StockLevelRepository;
import com.lumora.pos.inventory.service.ProductService;
import com.lumora.pos.returns.dto.ExchangeItemRequest;
import com.lumora.pos.returns.dto.ReturnItemRequest;
import com.lumora.pos.returns.dto.ReturnItemResponse;
import com.lumora.pos.returns.dto.ReturnRequest;
import com.lumora.pos.returns.dto.ReturnResponse;
import com.lumora.pos.returns.entity.ReturnEntity;
import com.lumora.pos.returns.entity.ReturnEntity.ReturnType;
import com.lumora.pos.returns.entity.ReturnItemEntity;
import com.lumora.pos.returns.repository.ReturnRepository;
import com.lumora.pos.sales.dto.SaleRequest;
import com.lumora.pos.sales.dto.SaleResponse;
import com.lumora.pos.sales.entity.SaleEntity;
import com.lumora.pos.sales.entity.SaleItemEntity;
import com.lumora.pos.sales.repository.SaleRepository;
import com.lumora.pos.sales.service.SaleService;
import com.lumora.pos.tenant.TenantContext;
import com.lumora.pos.auth.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class ReturnService {

    private final ReturnRepository returnRepository;
    private final SaleRepository saleRepository;
    private final SaleService saleService;
    private final ProductService productService;
    private final ProductRepository productRepository;
    private final AuditService auditService;
    private final UserRepository userRepository;
    private final InventoryAdjustmentRepository adjustmentRepository;
    private final StockLevelRepository stockLevelRepository;
    private final BranchRepository branchRepository;
    private final BranchAccessGuard branchAccessGuard;

    // High value returns require manager approval
    private static final BigDecimal AUTO_APPROVE_THRESHOLD = new BigDecimal("500.00");

    @Transactional
    public ReturnResponse createReturn(ReturnRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        SaleEntity sale = saleRepository.findByIdAndTenantId(request.getSaleId(), tenantId)
                .orElseThrow(() -> new BusinessException("Sale not found"));

        // Returns restore stock to the sale's branch — enforce access to it.
        // Legacy sales (pre-V35) have no branch; nothing to enforce against.
        if (sale.getBranch() != null) {
            branchAccessGuard.assertCanAccess(sale.getBranch().getId());
        }

        if (!sale.getPaymentStatus().equals(SaleEntity.PaymentStatus.PAID)
                && !sale.getPaymentStatus().equals(SaleEntity.PaymentStatus.PARTIAL)) {
            throw new BusinessException("Cannot return items for an unpaid or cancelled sale");
        }

        // Determine return type from reason
        ReturnType returnType = resolveReturnType(request);

        Map<UUID, SaleItemEntity> saleItemMap = sale.getItems().stream()
                .collect(Collectors.toMap(SaleItemEntity::getId, item -> item));

        List<ReturnEntity> pastReturns = returnRepository.findAllBySaleIdAndTenantIdOrderByCreatedAtDesc(
                sale.getId(), tenantId);

        ReturnEntity returnEntity = new ReturnEntity();
        returnEntity.setTenantId(tenantId);
        returnEntity.setSale(sale);
        returnEntity.setReturnNumber("RET-" + System.currentTimeMillis());
        returnEntity.setReason(request.getReason());
        returnEntity.setReturnType(returnType);
        returnEntity.setRefundMethod(request.getRefundMethod());
        returnEntity.setNotes(request.getNotes());

        UUID currentUserId = getCurrentUserId();
        returnEntity.setProcessedBy(currentUserId);

        BigDecimal totalRefund = BigDecimal.ZERO;

        for (ReturnItemRequest itemReq : request.getItems()) {
            SaleItemEntity saleItem = saleItemMap.get(itemReq.getSaleItemId());
            if (saleItem == null) {
                throw new BusinessException("Sale item not found in this sale");
            }

            BigDecimal alreadyReturned = pastReturns.stream()
                    .filter(ret -> !ret.getStatus().equals(ReturnEntity.ReturnStatus.REJECTED))
                    .flatMap(ret -> ret.getItems().stream())
                    .filter(ri -> ri.getSaleItem().getId().equals(saleItem.getId()))
                    .map(ReturnItemEntity::getQuantityReturned)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);

            BigDecimal remainingQty = saleItem.getQuantity().subtract(alreadyReturned);
            if (itemReq.getQuantity().compareTo(remainingQty) > 0) {
                throw new BusinessException("Cannot return more than purchased/remaining for product");
            }

            BigDecimal effectiveUnitPrice = saleItem.getTotalAmount()
                    .divide(saleItem.getQuantity(), 4, RoundingMode.HALF_UP);

            BigDecimal itemRefundAmount = effectiveUnitPrice.multiply(itemReq.getQuantity())
                    .setScale(2, RoundingMode.HALF_UP);

            ReturnItemEntity returnItem = new ReturnItemEntity();
            returnItem.setTenantId(tenantId);
            returnItem.setReturnEntity(returnEntity);
            returnItem.setSaleItem(saleItem);
            returnItem.setProductId(saleItem.getProductId());
            returnItem.setQuantityReturned(itemReq.getQuantity());
            returnItem.setUnitPrice(effectiveUnitPrice);
            returnItem.setRefundAmount(itemRefundAmount);

            returnEntity.getItems().add(returnItem);
            totalRefund = totalRefund.add(itemRefundAmount);
        }

        returnEntity.setRefundAmount(totalRefund);

        if (totalRefund.compareTo(AUTO_APPROVE_THRESHOLD) > 0) {
            returnEntity.setStatus(ReturnEntity.ReturnStatus.PENDING);
        } else {
            returnEntity.setStatus(ReturnEntity.ReturnStatus.COMPLETED);
            returnEntity.setApprovedBy(currentUserId);
            processReturnCompleted(returnEntity, sale);
        }

        ReturnEntity savedReturn = returnRepository.save(returnEntity);
        ReturnResponse response = mapToResponse(savedReturn);

        auditService.logCreate("RETURN", savedReturn.getId(), response);

        return response;
    }

    @Transactional(readOnly = true)
    public Page<ReturnResponse> getAllReturns(Pageable pageable) {
        return returnRepository.findAllByTenantId(TenantContext.getTenantId(), pageable)
                .map(this::mapToResponse);
    }

    @Transactional(readOnly = true)
    public ReturnResponse getReturnById(UUID id) {
        return returnRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .map(this::mapToResponse)
                .orElseThrow(() -> new BusinessException("Return not found"));
    }

    @Transactional(readOnly = true)
    public List<ReturnResponse> getReturnsBySaleId(UUID saleId) {
        return returnRepository.findAllBySaleIdAndTenantIdOrderByCreatedAtDesc(saleId, TenantContext.getTenantId())
                .stream().map(this::mapToResponse).toList();
    }

    @Transactional
    public ReturnResponse approveReturn(UUID id, boolean approve) {
        UUID tenantId = TenantContext.getTenantId();
        ReturnEntity returnEntity = returnRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Return not found"));

        if (!returnEntity.getStatus().equals(ReturnEntity.ReturnStatus.PENDING)) {
            throw new BusinessException("Only PENDING returns can be approved/rejected");
        }

        UUID currentUserId = getCurrentUserId();

        if (approve) {
            returnEntity.setStatus(ReturnEntity.ReturnStatus.COMPLETED);
            returnEntity.setApprovedBy(currentUserId);
            processReturnCompleted(returnEntity, returnEntity.getSale());
            auditService.logCreate("APPROVE_RETURN", id, Map.of("action", "Approved by manager"));
        } else {
            returnEntity.setStatus(ReturnEntity.ReturnStatus.REJECTED);
            auditService.logCreate("REJECT_RETURN", id, Map.of("action", "Rejected by manager"));
        }

        return mapToResponse(returnRepository.save(returnEntity));
    }

    // ─── CORE LOGIC: Reason-based return processing ─────────────

    /**
     * Resolves the return type based on the reason and explicit request type.
     */
    private ReturnType resolveReturnType(ReturnRequest request) {
        // If explicitly set by the frontend, respect it
        if (request.getReturnType() != null) {
            return request.getReturnType();
        }
        // Otherwise auto-detect from reason
        String reason = request.getReason();
        if ("Defective / Damaged".equalsIgnoreCase(reason)) {
            return ReturnType.DAMAGED_WRITEOFF;
        } else if ("Exchange".equalsIgnoreCase(reason)) {
            return ReturnType.EXCHANGE;
        }
        return ReturnType.REFUND;
    }

    /**
     * Processes a completed return based on its type.
     * - REFUND: Restore stock + mark sale refunded
     * - DAMAGED_WRITEOFF: Skip stock restore (item is unsellable) + mark sale
     * refunded
     * - EXCHANGE: Restore returned stock, create new sale for replacement items,
     * deduct new stock
     */
    private void processReturnCompleted(ReturnEntity returnEntity, SaleEntity sale) {
        ReturnType type = returnEntity.getReturnType();

        switch (type) {
            case REFUND:
                // Normal: restore stock for returned items
                restoreStock(returnEntity, sale);
                break;

            case DAMAGED_WRITEOFF:
                // Defective/Damaged: DO NOT restore stock — item is unsellable.
                // Stock was already deducted at the original sale; we just record
                // a DAMAGE adjustment row so the loss surfaces in the variance
                // report (refund went out, unit can't be resold).
                log.info("DAMAGED_WRITEOFF return [{}]: Stock NOT restored (items written off)",
                        returnEntity.getReturnNumber());
                recordDamageWriteoff(returnEntity, sale);
                break;

            case EXCHANGE:
                // Exchange: restore stock for returned items + create replacement sale
                restoreStock(returnEntity, sale);
                // Exchange sale creation is handled separately when the request includes
                // exchangeItems
                break;
        }

        // Mark original sale as refunded
        sale.setPaymentStatus(SaleEntity.PaymentStatus.REFUNDED);
        saleRepository.save(sale);
    }

    /**
     * Writes a DAMAGE inventory_adjustment row per damaged-return item so the
     * loss is visible in the Stock Variance report. Stock levels are NOT
     * mutated — the unit was already deducted at the original sale, the
     * adjustment row exists purely as an audit/shrinkage record. previousQuantity
     * and newQuantity are both set to the current stock snapshot so the entry
     * truthfully shows "stock unchanged, but N units lost".
     */
    private void recordDamageWriteoff(ReturnEntity returnEntity, SaleEntity sale) {
        UUID tenantId = TenantContext.getTenantId();
        BranchEntity branch = sale.getBranch();
        if (branch == null) {
            // Legacy sale (pre-V35): fall back to default branch so the loss is
            // still recorded somewhere instead of being silently dropped.
            branch = branchRepository.findByIsDefaultTrueAndTenantId(tenantId).orElse(null);
            if (branch == null) {
                log.warn("Cannot record damage write-off for return {} — no branch available",
                        returnEntity.getReturnNumber());
                return;
            }
        }

        for (ReturnItemEntity item : returnEntity.getItems()) {
            ProductEntity product = productRepository.findByIdAndTenantId(item.getProductId(), tenantId)
                    .orElse(null);
            if (product == null) continue;

            int stockSnapshot = stockLevelRepository
                    .findByProductIdAndBranchIdAndTenantId(product.getId(), branch.getId(), tenantId)
                    .map(StockLevelEntity::getQuantity)
                    .orElse(0);

            InventoryAdjustmentEntity adj = new InventoryAdjustmentEntity();
            adj.setTenantId(tenantId);
            adj.setProduct(product);
            adj.setBranch(branch);
            adj.setType(InventoryAdjustmentEntity.AdjustmentType.DAMAGE);
            adj.setPreviousQuantity(stockSnapshot);
            adj.setNewQuantity(stockSnapshot); // unchanged — see method javadoc
            adj.setQuantity(item.getQuantityReturned().intValue());
            adj.setReason("Damaged return");
            adj.setReferenceId(returnEntity.getReturnNumber());
            adjustmentRepository.save(adj);
        }
    }

    /**
     * Restores stock for all items in a return, crediting the branch the
     * original sale happened at. Legacy sales created before V35 have no
     * branch attribution and fall back to the default-branch updateStock path
     * with a logged warning so the gap is observable in audit.
     *
     * A line with no productId is skipped. Both kinds of such line — a V49
     * custom/open line and a V61 topping — are priced text with no catalogue
     * entry and no stock_levels row, so there is nothing to restore. Without
     * this guard the null reaches findByIdAndTenantId, matches nothing, and
     * updateStock throws "Product not found", failing a refund the customer is
     * owed. (Untracked products are handled a level down, in ProductService.)
     */
    private void restoreStock(ReturnEntity returnEntity, SaleEntity sale) {
        UUID branchId = sale.getBranch() != null ? sale.getBranch().getId() : null;
        for (ReturnItemEntity item : returnEntity.getItems()) {
            if (item.getProductId() == null) continue;
            int qty = item.getQuantityReturned().intValue();
            if (branchId != null) {
                productService.updateStockForBranch(
                        item.getProductId(), branchId, qty,
                        "Return " + returnEntity.getReturnNumber());
            } else {
                log.warn("Return {} on legacy sale {} has no branch attribution; restoring to default branch",
                        returnEntity.getReturnNumber(), sale.getId());
                productService.updateStock(item.getProductId(), qty);
            }
        }
    }

    /**
     * Creates a replacement sale for exchange returns and links it to the return
     * entity.
     */
    @Transactional
    public ReturnResponse processExchange(ReturnRequest request) {
        // First, create the return (restores stock for old items)
        request.setReturnType(ReturnType.EXCHANGE);
        request.setRefundMethod(ReturnEntity.RefundMethod.STORE_CREDIT); // Exchange uses store credit

        ReturnResponse returnResponse = createReturn(request);

        // Now create the exchange sale for replacement items
        if (request.getExchangeItems() != null && !request.getExchangeItems().isEmpty()) {
            UUID tenantId = TenantContext.getTenantId();

            // Build a sale request for the replacement items
            List<SaleRequest.SaleItemRequest> exchangeSaleItems = request.getExchangeItems().stream()
                    .map(ei -> SaleRequest.SaleItemRequest.builder()
                            .productId(ei.getProductId())
                            .quantity(ei.getQuantity())
                            .unitPrice(ei.getUnitPrice())
                            .discountAmount(BigDecimal.ZERO)
                            .build())
                    .toList();

            // Determine payment method from original sale
            SaleEntity originalSale = saleRepository.findByIdAndTenantId(request.getSaleId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Original sale not found"));

            SaleRequest exchangeSaleRequest = SaleRequest.builder()
                    .paymentMethod(originalSale.getPaymentMethod().name())
                    .items(exchangeSaleItems)
                    .build();

            SaleResponse exchangeSale = saleService.createSale(exchangeSaleRequest);

            // Link exchange sale to the return
            ReturnEntity returnEntity = returnRepository.findByIdAndTenantId(
                    returnResponse.getId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Return not found after creation"));

            returnEntity.setExchangeSaleId(exchangeSale.getId());
            returnRepository.save(returnEntity);

            // Update the response with exchange details
            returnResponse = mapToResponse(returnEntity);

            auditService.logCreate("EXCHANGE_SALE", exchangeSale.getId(),
                    Map.of("returnId", returnResponse.getId(), "exchangeSaleId", exchangeSale.getId()));
        }

        return returnResponse;
    }

    // ─── MAPPING ─────────────────────────────────────────────

    private ReturnResponse mapToResponse(ReturnEntity entity) {
        String processedByName = null;
        if (entity.getProcessedBy() != null) {
            processedByName = userRepository.findById(entity.getProcessedBy())
                    .map(u -> u.getFirstName() + " " + u.getLastName())
                    .orElse("Unknown");
        }
        String approvedByName = null;
        if (entity.getApprovedBy() != null) {
            approvedByName = userRepository.findById(entity.getApprovedBy())
                    .map(u -> u.getFirstName() + " " + u.getLastName())
                    .orElse("Unknown");
        }

        // Calculate exchange totals if applicable
        BigDecimal exchangeTotal = null;
        BigDecimal priceDifference = null;
        if (entity.getReturnType() == ReturnType.EXCHANGE && entity.getExchangeSaleId() != null) {
            SaleEntity exchangeSale = saleRepository.findById(entity.getExchangeSaleId()).orElse(null);
            if (exchangeSale != null) {
                exchangeTotal = exchangeSale.getNetAmount();
                priceDifference = exchangeTotal.subtract(entity.getRefundAmount());
            }
        }

        // Batch-fetch all product names in one query (avoids N+1 per item)
        List<UUID> productIds = entity.getItems().stream()
                .map(ReturnItemEntity::getProductId)
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
        Map<UUID, String> productNames = productRepository
                .findAllByIdInAndTenantId(productIds, TenantContext.getTenantId())
                .stream()
                .collect(Collectors.toMap(ProductEntity::getId, ProductEntity::getName));

        return ReturnResponse.builder()
                .id(entity.getId())
                .saleId(entity.getSale().getId())
                .returnNumber(entity.getReturnNumber())
                .invoiceNumber(entity.getSale().getInvoiceNumber())
                .reason(entity.getReason())
                .returnType(entity.getReturnType())
                .status(entity.getStatus())
                .refundAmount(entity.getRefundAmount())
                .refundMethod(entity.getRefundMethod())
                .processedBy(entity.getProcessedBy())
                .processedByName(processedByName)
                .approvedBy(entity.getApprovedBy())
                .approvedByName(approvedByName)
                .notes(entity.getNotes())
                .exchangeSaleId(entity.getExchangeSaleId())
                .exchangeTotal(exchangeTotal)
                .priceDifference(priceDifference)
                .items(entity.getItems().stream().map(item -> mapItem(item, productNames)).toList())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }

    private ReturnItemResponse mapItem(ReturnItemEntity item, Map<UUID, String> productNames) {
        return ReturnItemResponse.builder()
                .id(item.getId())
                .saleItemId(item.getSaleItem().getId())
                .productId(item.getProductId())
                // A custom line or a topping has no product to name itself after;
                // the sale line's own text is the only name it ever had.
                .productName(item.getProductId() == null
                        ? item.getSaleItem().getItemName()
                        : productNames.getOrDefault(item.getProductId(), "Unknown Product"))
                .quantityReturned(item.getQuantityReturned())
                .unitPrice(item.getUnitPrice())
                .refundAmount(item.getRefundAmount())
                .build();
    }

    private UUID getCurrentUserId() {
        try {
            Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
            if (principal instanceof UUID) {
                return (UUID) principal;
            }
            return UUID.fromString(principal.toString());
        } catch (Exception e) {
            return null;
        }
    }
}
