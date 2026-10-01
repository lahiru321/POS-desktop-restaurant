package com.lumora.pos.purchase.service;

import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.ingredient.entity.IngredientEntity;
import com.lumora.pos.ingredient.service.IngredientService;
import com.lumora.pos.ingredient.service.IngredientStockService;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.service.ProductService;
import com.lumora.pos.purchase.dto.PurchaseOrderRequest;
import com.lumora.pos.purchase.dto.PurchaseOrderResponse;
import com.lumora.pos.purchase.dto.ReceivePoItemRequest;
import com.lumora.pos.purchase.entity.PurchaseOrderEntity;
import com.lumora.pos.purchase.entity.PurchaseOrderItemEntity;
import com.lumora.pos.purchase.repository.PurchaseOrderRepository;
import com.lumora.pos.supplier.entity.SupplierEntity;
import com.lumora.pos.supplier.repository.SupplierRepository;
import com.lumora.pos.tenant.TenantContext;
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
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class PurchaseOrderService {

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final SupplierRepository supplierRepository;
    private final BranchRepository branchRepository;
    private final ProductRepository productRepository;
    private final ProductService productService;
    private final AuditService auditService;
    private final UserRepository userRepository;
    private final BranchAccessGuard branchAccessGuard;
    private final IngredientService ingredientService;
    private final IngredientStockService ingredientStockService;

    @Transactional
    public PurchaseOrderResponse createPurchaseOrder(PurchaseOrderRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        // A PO delivers to a branch — the caller must have access to that branch.
        branchAccessGuard.assertCanAccess(request.getBranchId());

        SupplierEntity supplier = supplierRepository.findByIdAndTenantId(request.getSupplierId(), tenantId)
                .orElseThrow(() -> new BusinessException("Supplier not found"));

        BranchEntity branch = branchRepository.findByIdAndTenantId(request.getBranchId(), tenantId)
                .orElseThrow(() -> new BusinessException("Branch not found"));

        UUID currentUserId = getCurrentUserId();

        PurchaseOrderEntity po = PurchaseOrderEntity.builder()
                .poNumber("PO-" + System.currentTimeMillis())
                .supplier(supplier)
                .branch(branch)
                .status(PurchaseOrderEntity.POStatus.DRAFT)
                .expectedDate(request.getExpectedDate())
                .notes(request.getNotes())
                .build();
        po.setTenantId(tenantId);
        po.setCreatedBy(currentUserId);

        BigDecimal totalAmount = BigDecimal.ZERO;

        for (PurchaseOrderRequest.PurchaseOrderItemRequest itemReq : request.getItems()) {
            boolean hasProduct = itemReq.getProductId() != null;
            if (hasProduct == (itemReq.getIngredientId() != null)) {
                throw new BusinessException("Each line must be either an ingredient or a menu item");
            }

            ProductEntity product = null;
            IngredientEntity ingredient = null;
            BigDecimal quantity;
            BigDecimal unitCost;
            if (hasProduct) {
                product = productRepository.findByIdAndTenantId(itemReq.getProductId(), tenantId)
                        .orElseThrow(() -> new BusinessException("Product not found: " + itemReq.getProductId()));
                // Receiving an untracked item used to add nothing and say nothing.
                if (!product.isTrackStock()) {
                    throw new BusinessException(product.getName()
                            + " is made to order, so it has no stock to buy. Turn on \"Sold as a packaged item\""
                            + " on the menu item, or order its ingredients instead");
                }
                quantity = wholeQuantity(itemReq.getQuantity(), product.getName());
                unitCost = itemReq.getUnitCost().setScale(2, RoundingMode.HALF_UP);
            } else {
                ingredient = ingredientService.requireActive(itemReq.getIngredientId());
                quantity = ingredientQuantity(itemReq.getQuantity());
                unitCost = ingredientCost(itemReq.getUnitCost());
            }

            BigDecimal itemTotal = unitCost.multiply(quantity).setScale(2, RoundingMode.HALF_UP);
            totalAmount = totalAmount.add(itemTotal);

            PurchaseOrderItemEntity item = PurchaseOrderItemEntity.builder()
                    .purchaseOrder(po)
                    .product(product)
                    .ingredient(ingredient)
                    .orderedQuantity(quantity)
                    .receivedQuantity(BigDecimal.ZERO)
                    .unitCost(unitCost)
                    .totalCost(itemTotal)
                    .build();
            item.setTenantId(tenantId);

            po.getItems().add(item);
        }

        po.setTotalAmount(totalAmount);

        PurchaseOrderEntity savedPo = purchaseOrderRepository.save(po);
        PurchaseOrderResponse response = mapToResponse(savedPo);

        auditService.logCreate("PURCHASE_ORDER", savedPo.getId(), response);

        return response;
    }

    @Transactional
    public PurchaseOrderResponse updatePOStatus(UUID id, PurchaseOrderEntity.POStatus newStatus) {
        PurchaseOrderEntity po = purchaseOrderRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Purchase Order not found"));

        po.setStatus(newStatus);
        PurchaseOrderEntity saved = purchaseOrderRepository.save(po);

        auditService.logUpdate("PURCHASE_ORDER_STATUS", saved.getId(), null, Map.of("newStatus", newStatus.name()));

        return mapToResponse(saved);
    }

    @Transactional
    public PurchaseOrderResponse receivePurchaseOrder(UUID id, List<ReceivePoItemRequest> receivedItems) {
        UUID tenantId = TenantContext.getTenantId();

        PurchaseOrderEntity po = purchaseOrderRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Purchase Order not found"));

        if (po.getStatus() == PurchaseOrderEntity.POStatus.RECEIVED) {
            throw new BusinessException("Purchase order is already fully received");
        }

        if (po.getStatus() == PurchaseOrderEntity.POStatus.CANCELLED) {
            throw new BusinessException("Cannot receive a cancelled purchase order");
        }

        boolean allFullyReceived = true;

        for (ReceivePoItemRequest req : receivedItems) {
            PurchaseOrderItemEntity poItem = po.getItems().stream()
                    .filter(item -> item.getId().equals(req.getPoItemId()))
                    .findFirst()
                    .orElseThrow(() -> new BusinessException("Purchase Order Item not found: " + req.getPoItemId()));

            // Calculate how many NEW items we are receiving in this transaction
            BigDecimal newQuantityToReceive = poItem.isIngredientLine()
                    ? ingredientQuantity(req.getReceivedQuantity())
                    : wholeQuantity(req.getReceivedQuantity(), poItem.getItemName());
            if (newQuantityToReceive.signum() <= 0)
                continue;

            BigDecimal totalNowReceived = poItem.getReceivedQuantity().add(newQuantityToReceive);

            if (totalNowReceived.compareTo(poItem.getOrderedQuantity()) > 0) {
                throw new BusinessException(
                        "Cannot receive more than ordered for: " + poItem.getItemName());
            }

            // Update item received quantity
            poItem.setReceivedQuantity(totalNowReceived);

            if (poItem.isIngredientLine()) {
                // Adds stock, writes a PURCHASE movement and takes this price as the last cost.
                ingredientStockService.receive(poItem.getIngredient(), po.getBranch().getId(),
                        newQuantityToReceive, poItem.getUnitCost(), po.getId(), po.getPoNumber());
            } else {
                // Stock tracking can be switched off after the PO was raised; receiving
                // would then silently add nothing.
                if (!poItem.getProduct().isTrackStock()) {
                    throw new BusinessException(poItem.getItemName()
                            + " no longer tracks stock — turn \"Sold as a packaged item\" back on to receive it");
                }
                // Critical phase: Automatically update the inventory stock
                // We pass branchId into the stock adjustment to ensure it increments the
                // correct warehouse
                productService.updateStockForBranch(
                        poItem.getProduct().getId(),
                        po.getBranch().getId(),
                        newQuantityToReceive.intValueExact(),
                        "PO Reception: " + po.getPoNumber());

                // Update product's cost price to reflect the new PO value
                ProductEntity product = poItem.getProduct();
                product.setCostPrice(poItem.getUnitCost().setScale(2, RoundingMode.HALF_UP));
                productRepository.save(product);
            }

            if (totalNowReceived.compareTo(poItem.getOrderedQuantity()) < 0) {
                allFullyReceived = false;
            }
        }

        // Double check all items
        for (PurchaseOrderItemEntity item : po.getItems()) {
            if (item.getReceivedQuantity().compareTo(item.getOrderedQuantity()) < 0) {
                allFullyReceived = false;
                break;
            }
        }

        po.setStatus(allFullyReceived ? PurchaseOrderEntity.POStatus.RECEIVED : PurchaseOrderEntity.POStatus.PARTIAL);
        po.setReceivedBy(getCurrentUserId());

        PurchaseOrderEntity saved = purchaseOrderRepository.save(po);

        auditService.logUpdate("PO_RECEIVED", saved.getId(), null, Map.of("status", saved.getStatus().name()));

        return mapToResponse(saved);
    }

    @Transactional(readOnly = true)
    public Page<PurchaseOrderResponse> getAllPOs(Pageable pageable) {
        return getAllPOs(null, null, null, pageable);
    }

    @Transactional(readOnly = true)
    public Page<PurchaseOrderResponse> getAllPOs(
            PurchaseOrderEntity.POStatus status,
            UUID supplierId,
            String search,
            Pageable pageable) {
        String normalizedSearch = (search == null || search.isBlank()) ? null : search.trim();
        return purchaseOrderRepository
                .findAll(PurchaseOrderRepository.filtered(
                        TenantContext.getTenantId(), status, supplierId, normalizedSearch), pageable)
                .map(this::mapToResponse);
    }

    @Transactional(readOnly = true)
    public PurchaseOrderResponse getPOById(UUID id) {
        return purchaseOrderRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .map(this::mapToResponse)
                .orElseThrow(() -> new BusinessException("Purchase Order not found"));
    }

    private PurchaseOrderResponse mapToResponse(PurchaseOrderEntity po) {
        String createdByName = po.getCreatedBy() != null ? userRepository.findById(po.getCreatedBy())
                .map(u -> u.getFirstName() + " " + u.getLastName()).orElse("Unknown") : null;

        String receivedByName = po.getReceivedBy() != null ? userRepository.findById(po.getReceivedBy())
                .map(u -> u.getFirstName() + " " + u.getLastName()).orElse("Unknown") : null;

        return PurchaseOrderResponse.builder()
                .id(po.getId())
                .poNumber(po.getPoNumber())
                .supplierId(po.getSupplier().getId())
                .supplierName(po.getSupplier().getName())
                .branchId(po.getBranch().getId())
                .branchName(po.getBranch().getName())
                .status(po.getStatus())
                .expectedDate(po.getExpectedDate())
                .totalAmount(po.getTotalAmount())
                .notes(po.getNotes())
                .createdBy(po.getCreatedBy())
                .createdByName(createdByName)
                .receivedBy(po.getReceivedBy())
                .receivedByName(receivedByName)
                .createdAt(po.getCreatedAt())
                .updatedAt(po.getUpdatedAt())
                .items(po.getItems().stream().map(this::mapItemToResponse).toList())
                .build();
    }

    private PurchaseOrderResponse.PurchaseOrderItemResponse mapItemToResponse(PurchaseOrderItemEntity item) {
        boolean ingredientLine = item.isIngredientLine();
        return PurchaseOrderResponse.PurchaseOrderItemResponse.builder()
                .id(item.getId())
                .itemType(ingredientLine ? "INGREDIENT" : "PRODUCT")
                .name(item.getItemName())
                .unit(ingredientLine ? item.getIngredient().getUnit().name() : "PCS")
                .productId(ingredientLine ? null : item.getProduct().getId())
                .ingredientId(ingredientLine ? item.getIngredient().getId() : null)
                .productName(item.getItemName())
                .sku(ingredientLine ? null : item.getProduct().getSku())
                .orderedQuantity(item.getOrderedQuantity())
                .receivedQuantity(item.getReceivedQuantity())
                .unitCost(item.getUnitCost())
                .totalCost(item.getTotalCost())
                .build();
    }

    /** Product stock is an INT, so a menu-item line is ordered and received in whole units. */
    private static BigDecimal wholeQuantity(BigDecimal quantity, String name) {
        if (quantity == null) {
            throw new BusinessException("Quantity is required");
        }
        BigDecimal stripped = quantity.stripTrailingZeros();
        if (stripped.scale() > 0) {
            throw new BusinessException(name + " is counted in whole units, not "
                    + stripped.toPlainString());
        }
        return quantity.setScale(3, RoundingMode.UNNECESSARY);
    }

    private static BigDecimal ingredientQuantity(BigDecimal quantity) {
        if (quantity == null) {
            throw new BusinessException("Quantity is required");
        }
        if (quantity.stripTrailingZeros().scale() > 3) {
            throw new BusinessException("Quantities can have at most 3 decimal places");
        }
        return quantity.setScale(3, RoundingMode.UNNECESSARY);
    }

    private static BigDecimal ingredientCost(BigDecimal unitCost) {
        if (unitCost.stripTrailingZeros().scale() > 4) {
            throw new BusinessException("Unit cost can have at most 4 decimal places");
        }
        return unitCost.setScale(4, RoundingMode.UNNECESSARY);
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
