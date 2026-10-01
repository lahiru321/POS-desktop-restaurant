package com.lumora.pos.ingredient.service;

import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.ingredient.dto.IngredientAdjustRequest;
import com.lumora.pos.ingredient.dto.IngredientMovementResponse;
import com.lumora.pos.ingredient.dto.IngredientRequest;
import com.lumora.pos.ingredient.dto.IngredientResponse;
import com.lumora.pos.ingredient.entity.IngredientMovementEntity.MovementType;
import com.lumora.pos.ingredient.entity.IngredientUnit;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The stock maths behind Record wastage / Stock count, and the guards around them:
 * stock never goes negative, every change leaves a movement whose balance matches
 * the shelf, and one tenant never sees another's ingredients.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class IngredientServiceIntegrationTest {

    @Autowired private IngredientService ingredientService;
    @Autowired private BranchRepository branchRepository;

    private UUID tenantId;
    private BranchEntity kitchen;
    private BranchEntity annex;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);
        kitchen = branch("Main outlet");
        annex = branch("Annex");
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    @Test
    void count_recordsTheDifferenceAndSetsTheQuantity() {
        IngredientResponse rice = create("Rice", IngredientUnit.KG, "5");

        IngredientResponse after = adjust(rice.getId(), kitchen, MovementType.COUNT, "12.5");
        assertThat(after.getQuantity()).isEqualByComparingTo("12.5");

        after = adjust(rice.getId(), kitchen, MovementType.COUNT, "10.250");
        assertThat(after.getQuantity()).isEqualByComparingTo("10.25");

        List<IngredientMovementResponse> history = ingredientService
                .movements(rice.getId(), kitchen.getId(), PageRequest.of(0, 10)).getContent();
        assertThat(history).extracting(m -> m.getQuantityChange().stripTrailingZeros().toPlainString())
                .containsExactlyInAnyOrder("12.5", "-2.25");
        assertThat(history).allSatisfy(m -> assertThat(m.getType()).isEqualTo(MovementType.COUNT));
    }

    @Test
    void wastage_takesStockOff_andCannotGoBelowZero() {
        IngredientResponse oil = create("Coconut oil", IngredientUnit.L, "0");
        adjust(oil.getId(), kitchen, MovementType.COUNT, "3");

        IngredientResponse after = adjust(oil.getId(), kitchen, MovementType.WASTAGE, "0.75");
        assertThat(after.getQuantity()).isEqualByComparingTo("2.25");

        assertThatThrownBy(() -> adjust(oil.getId(), kitchen, MovementType.WASTAGE, "2.3"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Only 2.25 L of Coconut oil in stock");
        assertThat(ingredientService.get(oil.getId(), kitchen.getId()).getQuantity()).isEqualByComparingTo("2.25");
    }

    @Test
    void adjust_rejectsNonsense() {
        IngredientResponse eggs = create("Eggs", IngredientUnit.PCS, "0");

        assertThatThrownBy(() -> adjust(eggs.getId(), kitchen, MovementType.WASTAGE, "0"))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> adjust(eggs.getId(), kitchen, MovementType.COUNT, "-1"))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> adjust(eggs.getId(), kitchen, MovementType.ADJUST, "-1"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("Only 0");
        assertThatThrownBy(() -> adjust(eggs.getId(), kitchen, MovementType.PURCHASE, "5"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("purchase order");
        assertThatThrownBy(() -> adjust(eggs.getId(), kitchen, MovementType.COUNT, "1.0005"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("3 decimal places");
    }

    @Test
    void stock_isPerBranch_andSummedWhenNoBranchIsGiven() {
        IngredientResponse flour = create("Flour", IngredientUnit.KG, "0");
        adjust(flour.getId(), kitchen, MovementType.COUNT, "4");
        adjust(flour.getId(), annex, MovementType.COUNT, "1.5");

        assertThat(ingredientService.get(flour.getId(), kitchen.getId()).getQuantity()).isEqualByComparingTo("4");
        assertThat(ingredientService.get(flour.getId(), annex.getId()).getQuantity()).isEqualByComparingTo("1.5");
        assertThat(ingredientService.get(flour.getId(), null).getQuantity()).isEqualByComparingTo("5.5");
    }

    @Test
    void lowStock_onlyWhenAnAlertIsSet() {
        IngredientResponse chilli = create("Chilli powder", IngredientUnit.G, "500");
        IngredientResponse salt = create("Salt", IngredientUnit.KG, "0");
        adjust(chilli.getId(), kitchen, MovementType.COUNT, "250");

        IngredientResponse value = ingredientService.get(chilli.getId(), kitchen.getId());
        assertThat(value.isLowStock()).isTrue();
        assertThat(ingredientService.lowStock(kitchen.getId()))
                .extracting(IngredientResponse::getName).containsExactly("Chilli powder");
        assertThat(ingredientService.get(salt.getId(), kitchen.getId()).isLowStock()).isFalse();
        assertThat(ingredientService.lowStockForTenant(tenantId, 10))
                .extracting(IngredientResponse::getName).containsExactly("Chilli powder");
    }

    @Test
    void stockValue_isQuantityTimesLastCost() {
        IngredientResponse saffron = ingredientService.create(IngredientRequest.builder()
                .name("Saffron").unit(IngredientUnit.G).costPerUnit(new BigDecimal("12.3456")).build());
        assertThat(saffron.getCostPerUnit()).isEqualByComparingTo("12.3456");

        adjust(saffron.getId(), kitchen, MovementType.COUNT, "10");
        assertThat(ingredientService.get(saffron.getId(), kitchen.getId()).getStockValue())
                .isEqualByComparingTo("123.46");
    }

    @Test
    void names_areUniqueIgnoringCase() {
        create("Rice", IngredientUnit.KG, "0");
        assertThatThrownBy(() -> create("  rice ", IngredientUnit.KG, "0"))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("already exists");
    }

    @Test
    void inactive_isHiddenFromTheDefaultListAndCannotBeOrdered() {
        IngredientResponse ghee = create("Ghee", IngredientUnit.KG, "0");
        ingredientService.toggleStatus(ghee.getId());

        assertThat(ingredientService.list(null, false)).isEmpty();
        assertThat(ingredientService.list(null, true)).extracting(IngredientResponse::getName).containsExactly("Ghee");
        assertThatThrownBy(() -> ingredientService.requireActive(ghee.getId()))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("inactive");
    }

    @Test
    void anotherTenant_cannotSeeOrTouchIt() {
        IngredientResponse rice = create("Rice", IngredientUnit.KG, "0");

        TenantContext.setTenantId(UUID.randomUUID());
        assertThat(ingredientService.list(null, true)).isEmpty();
        assertThatThrownBy(() -> ingredientService.get(rice.getId(), null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("not found");
        assertThatThrownBy(() -> adjust(rice.getId(), kitchen, MovementType.COUNT, "1"))
                .isInstanceOf(BusinessException.class);
        // The other tenant's name is free here.
        assertThat(create("Rice", IngredientUnit.KG, "0").getId()).isNotEqualTo(rice.getId());
    }

    private IngredientResponse create(String name, IngredientUnit unit, String threshold) {
        return ingredientService.create(IngredientRequest.builder()
                .name(name)
                .unit(unit)
                .costPerUnit(new BigDecimal("1"))
                .lowStockThreshold(new BigDecimal(threshold))
                .build());
    }

    private IngredientResponse adjust(UUID id, BranchEntity branch, MovementType type, String quantity) {
        return ingredientService.adjust(id, IngredientAdjustRequest.builder()
                .branchId(branch.getId())
                .type(type)
                .quantity(new BigDecimal(quantity))
                .build());
    }

    private BranchEntity branch(String name) {
        BranchEntity b = BranchEntity.builder().name(name).isDefault(false).isActive(true).build();
        b.setTenantId(tenantId);
        return branchRepository.save(b);
    }
}
