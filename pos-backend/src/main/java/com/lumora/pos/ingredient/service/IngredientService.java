package com.lumora.pos.ingredient.service;

import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.ingredient.dto.IngredientAdjustRequest;
import com.lumora.pos.ingredient.dto.IngredientMovementResponse;
import com.lumora.pos.ingredient.dto.IngredientRequest;
import com.lumora.pos.ingredient.dto.IngredientResponse;
import com.lumora.pos.ingredient.entity.IngredientEntity;
import com.lumora.pos.ingredient.entity.IngredientMovementEntity;
import com.lumora.pos.ingredient.entity.IngredientStockLevelEntity;
import com.lumora.pos.ingredient.repository.IngredientMovementRepository;
import com.lumora.pos.ingredient.repository.IngredientRepository;
import com.lumora.pos.ingredient.repository.IngredientStockLevelRepository;
import com.lumora.pos.supplier.entity.SupplierEntity;
import com.lumora.pos.supplier.repository.SupplierRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

/**
 * The ingredient catalogue and its per-branch stock. Stock itself only changes
 * through {@link IngredientStockService}.
 *
 * <p>Lists are small (a restaurant buys tens of ingredients, not thousands), so
 * stock is summed in memory from one read of the stock rows rather than with a
 * query per branch-filter shape.
 */
@Service
@RequiredArgsConstructor
public class IngredientService {

    private final IngredientRepository ingredientRepository;
    private final IngredientStockLevelRepository stockLevelRepository;
    private final IngredientMovementRepository movementRepository;
    private final IngredientStockService stockService;
    private final SupplierRepository supplierRepository;
    private final UserRepository userRepository;
    private final BranchAccessGuard branchAccessGuard;
    private final AuditService auditService;

    /**
     * Every ingredient with its stock at {@code branchId}, or summed over the
     * caller's branches when none is given.
     */
    @Transactional(readOnly = true)
    public List<IngredientResponse> list(UUID branchId, boolean includeInactive) {
        UUID tenantId = TenantContext.getTenantId();
        Map<UUID, BigDecimal> stock = stockByIngredient(tenantId, branchAccessGuard.reportBranchFilter(branchId));
        return ingredientRepository.findAllByTenantIdOrderByNameAsc(tenantId).stream()
                .filter(i -> includeInactive || i.isActive())
                .map(i -> toResponse(i, stock.get(i.getId())))
                .toList();
    }

    /** Active ingredients at or below their alert, for the Ingredients page filter. */
    @Transactional(readOnly = true)
    public List<IngredientResponse> lowStock(UUID branchId) {
        return list(branchId, false).stream().filter(IngredientResponse::isLowStock).toList();
    }

    /**
     * Low-stock ingredients across the whole tenant, for the dashboard — which,
     * like its product alerts, is not branch-scoped.
     */
    @Transactional(readOnly = true)
    public List<IngredientResponse> lowStockForTenant(UUID tenantId, int limit) {
        Map<UUID, BigDecimal> stock = stockByIngredient(tenantId, Optional.empty());
        return ingredientRepository.findAllByTenantIdOrderByNameAsc(tenantId).stream()
                .filter(IngredientEntity::isActive)
                .map(i -> toResponse(i, stock.get(i.getId())))
                .filter(IngredientResponse::isLowStock)
                .limit(limit)
                .toList();
    }

    @Transactional(readOnly = true)
    public IngredientResponse get(UUID id, UUID branchId) {
        UUID tenantId = TenantContext.getTenantId();
        IngredientEntity ingredient = find(id);
        Map<UUID, BigDecimal> stock = stockByIngredient(tenantId, branchAccessGuard.reportBranchFilter(branchId));
        return toResponse(ingredient, stock.get(id));
    }

    @Transactional
    public IngredientResponse create(IngredientRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        String name = request.getName().trim();
        if (ingredientRepository.existsByTenantIdAndNameIgnoreCase(tenantId, name)) {
            throw duplicate(name);
        }

        IngredientEntity ingredient = IngredientEntity.builder()
                .name(name)
                .unit(request.getUnit())
                .costPerUnit(cost(request.getCostPerUnit()))
                .lowStockThreshold(threshold(request.getLowStockThreshold()))
                .primarySupplier(supplier(request.getPrimarySupplierId()))
                .isActive(true)
                .build();
        ingredient.setTenantId(tenantId);

        IngredientEntity saved = save(ingredient);
        IngredientResponse response = toResponse(saved, null);
        auditService.logCreate("INGREDIENT", saved.getId(), response);
        return response;
    }

    /** Full replace of the catalogue fields. Stock is untouched. */
    @Transactional
    public IngredientResponse update(UUID id, IngredientRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        IngredientEntity ingredient = find(id);
        String name = request.getName().trim();
        if (ingredientRepository.existsByTenantIdAndNameIgnoreCaseAndIdNot(tenantId, name, id)) {
            throw duplicate(name);
        }
        IngredientResponse before = toResponse(ingredient, null);

        ingredient.setName(name);
        ingredient.setUnit(request.getUnit());
        ingredient.setCostPerUnit(cost(request.getCostPerUnit()));
        ingredient.setLowStockThreshold(threshold(request.getLowStockThreshold()));
        ingredient.setPrimarySupplier(supplier(request.getPrimarySupplierId()));

        IngredientResponse after = toResponse(save(ingredient), null);
        auditService.logUpdate("INGREDIENT", id, before, after);
        return get(id, null);
    }

    /**
     * Ingredients are never deleted — movements and purchase orders point at them.
     * An inactive one is hidden from purchase orders and the default list.
     */
    @Transactional
    public IngredientResponse toggleStatus(UUID id) {
        IngredientEntity ingredient = find(id);
        ingredient.setActive(!ingredient.isActive());
        ingredientRepository.save(ingredient);
        auditService.logUpdate("INGREDIENT_STATUS", id, null, Map.of("isActive", ingredient.isActive()));
        return get(id, null);
    }

    /** Record wastage, a stock count or a correction; returns the ingredient at that branch. */
    @Transactional
    public IngredientResponse adjust(UUID id, IngredientAdjustRequest request) {
        branchAccessGuard.assertCanAccess(request.getBranchId());
        IngredientEntity ingredient = find(id);
        stockService.adjust(ingredient, request.getBranchId(), request.getType(), request.getQuantity(),
                request.getReason());
        return get(id, request.getBranchId());
    }

    @Transactional(readOnly = true)
    public Page<IngredientMovementResponse> movements(UUID id, UUID branchId, Pageable pageable) {
        UUID tenantId = TenantContext.getTenantId();
        find(id);
        Optional<Set<UUID>> branches = branchAccessGuard.reportBranchFilter(branchId);
        Page<IngredientMovementEntity> page = branches.isPresent()
                ? movementRepository.findAllByTenantIdAndIngredientIdAndBranchIdInOrderByCreatedAtDesc(
                        tenantId, id, branches.get(), pageable)
                : movementRepository.findAllByTenantIdAndIngredientIdOrderByCreatedAtDesc(tenantId, id, pageable);

        Set<UUID> userIds = page.stream().map(IngredientMovementEntity::getCreatedBy)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        Map<UUID, String> names = new HashMap<>();
        if (!userIds.isEmpty()) {
            userRepository.findAllById(userIds)
                    .forEach(u -> names.put(u.getId(), u.getFirstName() + " " + u.getLastName()));
        }

        return page.map(m -> IngredientMovementResponse.builder()
                .id(m.getId())
                .type(m.getMovementType())
                .branchId(m.getBranch().getId())
                .branchName(m.getBranch().getName())
                .quantityChange(m.getQuantityChange())
                .quantityAfter(m.getQuantityAfter())
                .unitCost(m.getUnitCost())
                .referenceId(m.getReferenceId())
                .reason(m.getReason())
                .createdByName(m.getCreatedBy() == null ? null : names.get(m.getCreatedBy()))
                .createdAt(m.getCreatedAt())
                .build());
    }

    /** For the purchase-order service: a tenant-scoped, active ingredient or a clear error. */
    @Transactional(readOnly = true)
    public IngredientEntity requireActive(UUID id) {
        IngredientEntity ingredient = find(id);
        if (!ingredient.isActive()) {
            throw new BusinessException(ingredient.getName() + " is inactive — reactivate it to order it");
        }
        return ingredient;
    }

    private IngredientEntity find(UUID id) {
        return ingredientRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Ingredient not found"));
    }

    /** Flushes so the case-insensitive unique index fires here, not at commit as a 500. */
    private IngredientEntity save(IngredientEntity ingredient) {
        try {
            return ingredientRepository.saveAndFlush(ingredient);
        } catch (DataIntegrityViolationException e) {
            throw duplicate(ingredient.getName());
        }
    }

    private Map<UUID, BigDecimal> stockByIngredient(UUID tenantId, Optional<Set<UUID>> branches) {
        List<IngredientStockLevelEntity> rows = branches.isPresent()
                ? (branches.get().isEmpty() ? List.of()
                        : stockLevelRepository.findAllByTenantIdAndBranchIdIn(tenantId, branches.get()))
                : stockLevelRepository.findAllByTenantId(tenantId);
        Map<UUID, BigDecimal> totals = new HashMap<>();
        for (IngredientStockLevelEntity row : rows) {
            totals.merge(row.getIngredient().getId(), row.getQuantity(), BigDecimal::add);
        }
        return totals;
    }

    private SupplierEntity supplier(UUID supplierId) {
        if (supplierId == null) {
            return null;
        }
        return supplierRepository.findByIdAndTenantId(supplierId, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Supplier not found"));
    }

    private static BigDecimal cost(BigDecimal value) {
        BigDecimal v = value == null ? BigDecimal.ZERO : value;
        if (v.stripTrailingZeros().scale() > IngredientStockService.COST_SCALE) {
            throw new BusinessException("Cost per unit can have at most "
                    + IngredientStockService.COST_SCALE + " decimal places");
        }
        return v.setScale(IngredientStockService.COST_SCALE, RoundingMode.UNNECESSARY);
    }

    private static BigDecimal threshold(BigDecimal value) {
        return IngredientStockService.quantity(value == null ? BigDecimal.ZERO : value);
    }

    private static BusinessException duplicate(String name) {
        return new BusinessException("An ingredient called \"" + name + "\" already exists");
    }

    private IngredientResponse toResponse(IngredientEntity i, BigDecimal onHand) {
        BigDecimal quantity = (onHand == null ? BigDecimal.ZERO : onHand)
                .setScale(IngredientStockService.QUANTITY_SCALE, RoundingMode.HALF_UP);
        BigDecimal threshold = i.getLowStockThreshold();
        boolean low = threshold != null && threshold.signum() > 0 && quantity.compareTo(threshold) <= 0;
        SupplierEntity supplier = i.getPrimarySupplier();
        return IngredientResponse.builder()
                .id(i.getId())
                .name(i.getName())
                .unit(i.getUnit())
                .costPerUnit(i.getCostPerUnit())
                .lowStockThreshold(threshold)
                .primarySupplierId(supplier == null ? null : supplier.getId())
                .primarySupplierName(supplier == null ? null : supplier.getName())
                .isActive(i.isActive())
                .quantity(quantity)
                .stockValue(quantity.multiply(i.getCostPerUnit()).setScale(2, RoundingMode.HALF_UP))
                .isLowStock(low)
                .createdAt(i.getCreatedAt())
                .updatedAt(i.getUpdatedAt())
                .build();
    }
}
