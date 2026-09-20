package com.lumora.pos.restaurant.service;

import com.lumora.pos.audit.AuditAction;
import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.restaurant.dto.ToppingDtos;
import com.lumora.pos.restaurant.entity.ProductToppingGroupEntity;
import com.lumora.pos.restaurant.entity.ToppingEntity;
import com.lumora.pos.restaurant.entity.ToppingGroupEntity;
import com.lumora.pos.restaurant.repository.ProductToppingGroupRepository;
import com.lumora.pos.restaurant.repository.ToppingGroupRepository;
import com.lumora.pos.restaurant.repository.ToppingRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Authoring and lookup of topping groups and their toppings.
 *
 * <p>This service never prices a sale. It owns the definitions; {@code SaleService}
 * reads them at ring-up and decides what is actually charged, which is what keeps
 * pricing authority in exactly one place.
 */
@Service
@RequiredArgsConstructor
public class ToppingService {

    private final ToppingGroupRepository groupRepository;
    private final ToppingRepository toppingRepository;
    private final ProductToppingGroupRepository productGroupRepository;
    private final ProductRepository productRepository;
    private final AuditService auditService;

    // ------------------------------------------------------------------
    // Groups
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<ToppingDtos.GroupResponse> listGroups() {
        UUID tenantId = TenantContext.getTenantId();
        List<ToppingGroupEntity> groups =
                groupRepository.findAllByTenantIdOrderBySortOrderAscNameAsc(tenantId);
        return withToppings(groups, tenantId);
    }

    @Transactional
    public ToppingDtos.GroupResponse createGroup(ToppingDtos.GroupRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        ToppingGroupEntity group = ToppingGroupEntity.builder()
                .name(request.getName().trim())
                .selectionMode(request.getSelectionMode() != null
                        ? request.getSelectionMode()
                        : ToppingGroupEntity.SelectionMode.MULTI)
                .minSelect(request.getMinSelect() != null ? request.getMinSelect() : 0)
                .maxSelect(request.getMaxSelect())
                .sortOrder(request.getSortOrder() != null ? request.getSortOrder() : 0)
                .isActive(request.isActive())
                .build();
        group.setTenantId(tenantId);

        ToppingGroupEntity saved = groupRepository.save(group);
        ToppingDtos.GroupResponse response = toResponse(saved, List.of());
        auditService.logCreate("TOPPING_GROUP", saved.getId(), response);
        return response;
    }

    @Transactional
    public ToppingDtos.GroupResponse updateGroup(UUID id, ToppingDtos.GroupRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        ToppingGroupEntity group = groupRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Topping group not found"));

        group.setName(request.getName().trim());
        if (request.getSelectionMode() != null) {
            group.setSelectionMode(request.getSelectionMode());
        }
        group.setMinSelect(request.getMinSelect() != null ? request.getMinSelect() : 0);
        group.setMaxSelect(request.getMaxSelect());
        if (request.getSortOrder() != null) {
            group.setSortOrder(request.getSortOrder());
        }
        group.setActive(request.isActive());

        ToppingGroupEntity saved = groupRepository.save(group);
        List<ToppingEntity> toppings =
                toppingRepository.findAllByGroupIdAndTenantIdOrderBySortOrderAscNameAsc(id, tenantId);
        ToppingDtos.GroupResponse response = toResponse(saved, toppings);
        auditService.log(AuditAction.UPDATE, "TOPPING_GROUP", id, null, response);
        return response;
    }

    /**
     * Deletes a group and, by database cascade, its toppings and every product
     * attachment.
     *
     * <p>Already-sold {@code sale_items} rows survive: they carry the topping's
     * name in {@code item_name} and only a nullable {@code topping_id} pointer, so
     * a historical receipt still reads correctly after the menu changes.
     */
    @Transactional
    public void deleteGroup(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        ToppingGroupEntity group = groupRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Topping group not found"));
        groupRepository.delete(group);
        auditService.log(AuditAction.DELETE, "TOPPING_GROUP", id, Map.of("name", group.getName()), null);
    }

    // ------------------------------------------------------------------
    // Toppings
    // ------------------------------------------------------------------

    @Transactional
    public ToppingDtos.ToppingResponse createTopping(ToppingDtos.ToppingUpsertRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        ToppingGroupEntity group = groupRepository.findByIdAndTenantId(request.getGroupId(), tenantId)
                .orElseThrow(() -> new BusinessException("Topping group not found"));

        ToppingEntity topping = ToppingEntity.builder()
                .group(group)
                .name(request.getName().trim())
                .priceMode(request.getPriceMode() != null
                        ? request.getPriceMode()
                        : ToppingEntity.PriceMode.FIXED)
                .defaultPrice(request.getDefaultPrice())
                .maxPrice(request.getMaxPrice())
                .sortOrder(request.getSortOrder() != null ? request.getSortOrder() : 0)
                .isActive(request.isActive())
                .build();
        topping.setTenantId(tenantId);
        normalizeCap(topping);

        ToppingEntity saved = toppingRepository.save(topping);
        ToppingDtos.ToppingResponse response = toResponse(saved);
        auditService.logCreate("TOPPING", saved.getId(), response);
        return response;
    }

    @Transactional
    public ToppingDtos.ToppingResponse updateTopping(UUID id, ToppingDtos.ToppingUpsertRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        ToppingEntity topping = toppingRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Topping not found"));

        if (!topping.getGroup().getId().equals(request.getGroupId())) {
            ToppingGroupEntity group = groupRepository.findByIdAndTenantId(request.getGroupId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Topping group not found"));
            topping.setGroup(group);
        }

        topping.setName(request.getName().trim());
        if (request.getPriceMode() != null) {
            topping.setPriceMode(request.getPriceMode());
        }
        topping.setDefaultPrice(request.getDefaultPrice());
        topping.setMaxPrice(request.getMaxPrice());
        if (request.getSortOrder() != null) {
            topping.setSortOrder(request.getSortOrder());
        }
        topping.setActive(request.isActive());
        normalizeCap(topping);

        ToppingEntity saved = toppingRepository.save(topping);
        ToppingDtos.ToppingResponse response = toResponse(saved);
        auditService.log(AuditAction.UPDATE, "TOPPING", id, null, response);
        return response;
    }

    @Transactional
    public void deleteTopping(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        ToppingEntity topping = toppingRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Topping not found"));
        toppingRepository.delete(topping);
        auditService.log(AuditAction.DELETE, "TOPPING", id, Map.of("name", topping.getName()), null);
    }

    /**
     * A ceiling only means anything for a typed price. Clearing it on a FIXED
     * topping keeps the row honest, so nobody later reads a stale cap as if it
     * constrained a price the server sets itself.
     */
    private void normalizeCap(ToppingEntity topping) {
        if (topping.getPriceMode() != ToppingEntity.PriceMode.PROMPT) {
            topping.setMaxPrice(null);
        }
    }

    // ------------------------------------------------------------------
    // Product attachment — what the till asks about
    // ------------------------------------------------------------------

    /**
     * The groups the till should offer when this product is tapped.
     *
     * <p>Inactive groups and inactive toppings are filtered out here rather than at
     * the client, so a topping withdrawn from the menu stops being offered
     * everywhere at once.
     */
    @Transactional(readOnly = true)
    public List<ToppingDtos.GroupResponse> groupsForProduct(UUID productId) {
        UUID tenantId = TenantContext.getTenantId();

        List<ToppingGroupEntity> groups =
                productGroupRepository.findAllByProductIdAndTenantIdOrderBySortOrderAsc(productId, tenantId)
                        .stream()
                        .map(ProductToppingGroupEntity::getGroup)
                        .filter(ToppingGroupEntity::isActive)
                        .toList();

        return withToppings(groups, tenantId).stream()
                .peek(group -> group.setToppings(
                        group.getToppings().stream()
                                .filter(ToppingDtos.ToppingResponse::isActive)
                                .toList()))
                .toList();
    }

    /** Replaces a product's group attachments wholesale — the product form posts the full set. */
    @Transactional
    public void setGroupsForProduct(UUID productId, List<UUID> groupIds) {
        UUID tenantId = TenantContext.getTenantId();
        ProductEntity product = productRepository.findByIdAndTenantId(productId, tenantId)
                .orElseThrow(() -> new BusinessException("Product not found"));

        productGroupRepository.deleteAllByProductIdAndTenantId(productId, tenantId);
        if (groupIds == null || groupIds.isEmpty()) {
            return;
        }

        int order = 0;
        List<ProductToppingGroupEntity> links = new ArrayList<>();
        for (UUID groupId : groupIds.stream().distinct().toList()) {
            ToppingGroupEntity group = groupRepository.findByIdAndTenantId(groupId, tenantId)
                    .orElseThrow(() -> new BusinessException("Topping group not found: " + groupId));
            ProductToppingGroupEntity link = ProductToppingGroupEntity.builder()
                    .product(product)
                    .group(group)
                    .sortOrder(order++)
                    .build();
            link.setTenantId(tenantId);
            links.add(link);
        }
        productGroupRepository.saveAll(links);
    }

    /** Which products have any add-ons at all — see the repository method's note. */
    @Transactional(readOnly = true)
    public List<UUID> productIdsWithToppings() {
        return productGroupRepository.findProductIdsWithToppings(TenantContext.getTenantId());
    }

    @Transactional(readOnly = true)
    public List<UUID> groupIdsForProduct(UUID productId) {
        UUID tenantId = TenantContext.getTenantId();
        return productGroupRepository.findAllByProductIdAndTenantIdOrderBySortOrderAsc(productId, tenantId)
                .stream()
                .map(link -> link.getGroup().getId())
                .toList();
    }

    // ------------------------------------------------------------------
    // Mapping
    // ------------------------------------------------------------------

    /** One query for every group's toppings rather than one per group. */
    private List<ToppingDtos.GroupResponse> withToppings(List<ToppingGroupEntity> groups, UUID tenantId) {
        if (groups.isEmpty()) {
            return List.of();
        }
        List<UUID> groupIds = groups.stream().map(ToppingGroupEntity::getId).toList();
        Map<UUID, List<ToppingEntity>> byGroup = toppingRepository
                .findAllByGroupIdInAndTenantIdOrderBySortOrderAscNameAsc(groupIds, tenantId)
                .stream()
                .collect(Collectors.groupingBy(topping -> topping.getGroup().getId()));

        return groups.stream()
                .sorted(Comparator.comparingInt(ToppingGroupEntity::getSortOrder))
                .map(group -> toResponse(group, byGroup.getOrDefault(group.getId(), List.of())))
                .toList();
    }

    private ToppingDtos.GroupResponse toResponse(ToppingGroupEntity group, List<ToppingEntity> toppings) {
        return ToppingDtos.GroupResponse.builder()
                .id(group.getId())
                .name(group.getName())
                .selectionMode(group.getSelectionMode())
                .minSelect(group.getMinSelect())
                .maxSelect(group.getMaxSelect())
                .sortOrder(group.getSortOrder())
                .isActive(group.isActive())
                .toppings(toppings.stream().map(this::toResponse).collect(Collectors.toList()))
                .build();
    }

    private ToppingDtos.ToppingResponse toResponse(ToppingEntity topping) {
        return ToppingDtos.ToppingResponse.builder()
                .id(topping.getId())
                .groupId(topping.getGroup().getId())
                .name(topping.getName())
                .priceMode(topping.getPriceMode())
                .defaultPrice(topping.getDefaultPrice())
                .maxPrice(topping.getMaxPrice())
                .sortOrder(topping.getSortOrder())
                .isActive(topping.isActive())
                .build();
    }
}
