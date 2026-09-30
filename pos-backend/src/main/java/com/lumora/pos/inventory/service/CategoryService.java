package com.lumora.pos.inventory.service;

import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.dto.CategoryRequest;
import com.lumora.pos.inventory.dto.CategoryResponse;
import com.lumora.pos.inventory.entity.CategoryEntity;
import com.lumora.pos.inventory.repository.CategoryRepository;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.tax.entity.TaxRateEntity;
import com.lumora.pos.tax.repository.TaxRateRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class CategoryService {

    private final CategoryRepository categoryRepository;
    private final ProductRepository productRepository;
    private final AuditService auditService;
    private final TaxRateRepository taxRateRepository;

    @Transactional(readOnly = true)
    public List<CategoryResponse> getAllCategories(String search) {
        UUID tenantId = TenantContext.getTenantId();
        List<CategoryEntity> categories = (search != null && !search.trim().isEmpty())
                ? categoryRepository.searchByName(tenantId, search.trim())
                : categoryRepository.findAllByTenantId(tenantId);
        return categories.stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public CategoryResponse getCategoryById(UUID id) {
        return categoryRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .map(this::mapToResponse)
                .orElseThrow(() -> new BusinessException("Category not found"));
    }

    @Transactional
    public CategoryResponse createCategory(CategoryRequest request) {
        CategoryEntity category = CategoryEntity.builder()
                .name(request.getName())
                .slug(request.getSlug())
                .description(request.getDescription())
                .kitchenStation(KitchenStations.normalize(request.getKitchenStation()))
                .build();

        if (request.getParentId() != null) {
            CategoryEntity parent = categoryRepository
                    .findByIdAndTenantId(request.getParentId(), TenantContext.getTenantId())
                    .orElseThrow(() -> new BusinessException("Parent category not found"));
            category.setParent(parent);
        }

        // Assign Tax Rate if provided
        if (request.getTaxRateId() != null) {
            TaxRateEntity taxRate = taxRateRepository
                    .findByIdAndTenantId(request.getTaxRateId(), TenantContext.getTenantId())
                    .orElseThrow(() -> new BusinessException("Tax rate not found"));
            category.setTaxRate(taxRate);
        }

        category.setTenantId(TenantContext.getTenantId());
        CategoryResponse response = mapToResponse(categoryRepository.save(category));

        // Audit: Record new category creation
        auditService.logCreate("CATEGORY", response.getId(), response);

        return response;
    }

    @Transactional
    public CategoryResponse updateCategory(UUID id, CategoryRequest request) {
        CategoryEntity category = categoryRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Category not found"));

        // Audit: Capture state BEFORE mutations
        CategoryResponse oldState = mapToResponse(category);

        category.setName(request.getName());
        category.setSlug(request.getSlug());
        category.setDescription(request.getDescription());
        category.setKitchenStation(KitchenStations.normalize(request.getKitchenStation()));

        if (request.getParentId() != null) {
            if (request.getParentId().equals(id)) {
                throw new BusinessException("Category cannot be its own parent");
            }
            CategoryEntity parent = categoryRepository
                    .findByIdAndTenantId(request.getParentId(), TenantContext.getTenantId())
                    .orElseThrow(() -> new BusinessException("Parent category not found"));
            category.setParent(parent);
        } else {
            category.setParent(null);
        }

        // Update Tax Rate assignment
        if (request.getTaxRateId() != null) {
            TaxRateEntity taxRate = taxRateRepository
                    .findByIdAndTenantId(request.getTaxRateId(), TenantContext.getTenantId())
                    .orElseThrow(() -> new BusinessException("Tax rate not found"));
            category.setTaxRate(taxRate);
        } else {
            category.setTaxRate(null);
        }

        CategoryResponse newState = mapToResponse(categoryRepository.save(category));

        // Audit: Record category update with before/after
        auditService.logUpdate("CATEGORY", id, oldState, newState);

        return newState;
    }

    @Transactional
    public void deleteCategory(UUID id) {
        CategoryEntity category = categoryRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Category not found"));

        // Audit: Capture snapshot BEFORE deletion
        CategoryResponse deletedState = mapToResponse(category);

        // Deletion Guard: Prevent deletion if products are linked
        UUID tenantId = TenantContext.getTenantId();
        long linkedProducts = productRepository.countByCategoryIdAndTenantId(id, tenantId);
        if (linkedProducts > 0) {
            throw new BusinessException(
                    "Cannot delete category '" + category.getName() + "': " +
                            linkedProducts + " product(s) are still linked to it. " +
                            "Please reassign or delete those products first.");
        }

        categoryRepository.delete(category);

        auditService.logDelete("CATEGORY", id, deletedState);
    }

    private CategoryResponse mapToResponse(CategoryEntity category) {
        return CategoryResponse.builder()
                .id(category.getId())
                .name(category.getName())
                .slug(category.getSlug())
                .description(category.getDescription())
                .parentId(category.getParent() != null ? category.getParent().getId() : null)
                .taxRateId(category.getTaxRate() != null ? category.getTaxRate().getId() : null)
                .taxRateName(category.getTaxRate() != null ? category.getTaxRate().getName() : null)
                .kitchenStation(category.getKitchenStation())
                .createdAt(category.getCreatedAt())
                .build();
    }
}
