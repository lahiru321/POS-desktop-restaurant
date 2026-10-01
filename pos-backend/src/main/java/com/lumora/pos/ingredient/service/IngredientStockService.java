package com.lumora.pos.ingredient.service;

import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.ingredient.entity.IngredientEntity;
import com.lumora.pos.ingredient.entity.IngredientMovementEntity;
import com.lumora.pos.ingredient.entity.IngredientMovementEntity.MovementType;
import com.lumora.pos.ingredient.entity.IngredientStockLevelEntity;
import com.lumora.pos.ingredient.repository.IngredientMovementRepository;
import com.lumora.pos.ingredient.repository.IngredientStockLevelRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.UUID;
import java.util.function.UnaryOperator;

/**
 * The one way ingredient stock changes. Every change locks the branch's stock row,
 * refuses to go below zero, and writes a movement carrying the resulting balance —
 * so the ledger always adds up to what is on the shelf.
 */
@Service
@RequiredArgsConstructor
public class IngredientStockService {

    /** Quantities are NUMERIC(12,3) — a gram of a kilo. */
    static final int QUANTITY_SCALE = 3;
    /** Costs are NUMERIC(12,4) — a per-gram price. */
    static final int COST_SCALE = 4;

    private final IngredientStockLevelRepository stockLevelRepository;
    private final IngredientMovementRepository movementRepository;
    private final BranchRepository branchRepository;

    /**
     * A purchase-order line arrived: add it to the branch's stock and make its
     * price the ingredient's cost per unit (last cost wins, as for products).
     */
    @Transactional
    public IngredientMovementEntity receive(IngredientEntity ingredient, UUID branchId, BigDecimal quantity,
                                            BigDecimal unitCost, UUID purchaseOrderId, String poNumber) {
        BigDecimal qty = quantity(quantity);
        if (qty.signum() <= 0) {
            throw new BusinessException("Received quantity must be more than zero");
        }
        ingredient.setCostPerUnit(unitCost.setScale(COST_SCALE, RoundingMode.HALF_UP));
        return record(ingredient, branchId, MovementType.PURCHASE, current -> qty,
                purchaseOrderId, "Received on " + poNumber);
    }

    /** Wastage, a stock count or a manual correction — see {@code IngredientAdjustRequest}. */
    @Transactional
    public IngredientMovementEntity adjust(IngredientEntity ingredient, UUID branchId, MovementType type,
                                           BigDecimal quantity, String reason) {
        BigDecimal qty = quantity(quantity);
        String why = reason == null || reason.isBlank() ? null : reason.trim();
        return switch (type) {
            case WASTAGE -> {
                if (qty.signum() <= 0) {
                    throw new BusinessException("Wastage must be more than zero");
                }
                yield record(ingredient, branchId, type, current -> qty.negate(), null, why);
            }
            case COUNT -> {
                if (qty.signum() < 0) {
                    throw new BusinessException("A counted quantity cannot be negative");
                }
                yield record(ingredient, branchId, type, qty::subtract, null, why);
            }
            case ADJUST -> {
                if (qty.signum() == 0) {
                    throw new BusinessException("An adjustment cannot be zero");
                }
                yield record(ingredient, branchId, type, current -> qty, null, why);
            }
            case PURCHASE -> throw new BusinessException("Stock is bought by receiving a purchase order");
        };
    }

    /** Rejects more than three decimal places rather than silently rounding a typed quantity. */
    static BigDecimal quantity(BigDecimal value) {
        if (value == null) {
            throw new BusinessException("Quantity is required");
        }
        BigDecimal stripped = value.stripTrailingZeros();
        if (stripped.scale() > QUANTITY_SCALE) {
            throw new BusinessException("Quantities can have at most " + QUANTITY_SCALE + " decimal places");
        }
        return value.setScale(QUANTITY_SCALE, RoundingMode.UNNECESSARY);
    }

    /** {@code 2.500} → {@code 2.5}, for messages. */
    static String plain(BigDecimal value) {
        return value.stripTrailingZeros().toPlainString();
    }

    private IngredientMovementEntity record(IngredientEntity ingredient, UUID branchId, MovementType type,
                                            UnaryOperator<BigDecimal> changeFromCurrent,
                                            UUID referenceId, String reason) {
        UUID tenantId = TenantContext.getTenantId();
        BranchEntity branch = branchRepository.findByIdAndTenantId(branchId, tenantId)
                .orElseThrow(() -> new BusinessException("Branch not found"));

        IngredientStockLevelEntity level = stockLevelRepository
                .findForUpdate(ingredient.getId(), branchId, tenantId)
                .orElseGet(() -> {
                    IngredientStockLevelEntity created = IngredientStockLevelEntity.builder()
                            .ingredient(ingredient)
                            .branch(branch)
                            .quantity(BigDecimal.ZERO.setScale(QUANTITY_SCALE))
                            .build();
                    created.setTenantId(tenantId);
                    return created;
                });

        BigDecimal current = level.getQuantity().setScale(QUANTITY_SCALE, RoundingMode.UNNECESSARY);
        BigDecimal change = changeFromCurrent.apply(current);
        BigDecimal after = current.add(change);
        if (after.signum() < 0) {
            throw new BusinessException("Only " + plain(current) + " " + ingredient.getUnit() + " of "
                    + ingredient.getName() + " in stock at " + branch.getName());
        }

        level.setQuantity(after);
        stockLevelRepository.save(level);

        IngredientMovementEntity movement = IngredientMovementEntity.builder()
                .ingredient(ingredient)
                .branch(branch)
                .movementType(type)
                .quantityChange(change)
                .quantityAfter(after)
                .unitCost(ingredient.getCostPerUnit())
                .referenceId(referenceId)
                .reason(reason)
                .build();
        movement.setTenantId(tenantId);
        return movementRepository.save(movement);
    }
}
