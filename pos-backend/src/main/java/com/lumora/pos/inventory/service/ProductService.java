package com.lumora.pos.inventory.service;

import com.lumora.pos.audit.AuditAction;
import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.dto.BranchStockRequest;
import com.lumora.pos.inventory.dto.LowStockResponse;
import com.lumora.pos.inventory.dto.ProductRequest;
import com.lumora.pos.inventory.dto.ProductResponse;
import com.lumora.pos.inventory.dto.StockLevelResponse;
import com.lumora.pos.inventory.entity.BrandEntity;
import com.lumora.pos.inventory.entity.CategoryEntity;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.BrandRepository;
import com.lumora.pos.inventory.repository.CategoryRepository;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.repository.ProductSpecification;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Collectors;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVPrinter;
import org.apache.commons.csv.CSVRecord;
import org.springframework.web.multipart.MultipartFile;

@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;
    private final BrandRepository brandRepository;
    private final com.lumora.pos.supplier.repository.SupplierRepository supplierRepository;
    private final com.lumora.pos.branch.repository.BranchRepository branchRepository;
    private final com.lumora.pos.inventory.repository.StockLevelRepository stockLevelRepository;
    private final com.lumora.pos.superadmin.repository.TenantConfigurationRepository tenantConfigurationRepository;
    private final AuditService auditService;

    @Transactional(readOnly = true)
    public Page<ProductResponse> getAllProducts(
            String search, UUID categoryId, UUID brandId, Boolean isActive, Pageable pageable) {

        UUID tenantId = TenantContext.getTenantId();

        Page<ProductEntity> productPage = productRepository.findAll(
                ProductSpecification.withFilters(tenantId, search, categoryId, brandId, isActive), pageable);

        List<ProductEntity> products = productPage.getContent();
        List<UUID> productIds = products.stream().map(ProductEntity::getId).collect(Collectors.toList());

        // Batch fetch all stock levels for all products in this page
        Map<UUID, List<com.lumora.pos.inventory.entity.StockLevelEntity>> stockLevelsByProduct = 
            stockLevelRepository.findAllByProductIdInAndTenantId(productIds, tenantId).stream()
                .collect(Collectors.groupingBy(sl -> sl.getProduct().getId()));

        return productPage.map(product -> 
            mapToResponse(product, stockLevelsByProduct.getOrDefault(product.getId(), List.of())));
    }

    @Transactional(readOnly = true)
    public Page<LowStockResponse> getLowStockAlerts(UUID branchId, Pageable pageable) {
        UUID tenantId = TenantContext.getTenantId();
        Page<com.lumora.pos.inventory.entity.StockLevelEntity> lowStock = stockLevelRepository
                .findLowStockByBranch(tenantId, branchId, pageable);

        return lowStock.map(sl -> LowStockResponse.builder()
                .productId(sl.getProduct().getId())
                .productName(sl.getProduct().getName())
                .productSku(sl.getProduct().getSku())
                .branchId(sl.getBranch().getId())
                .branchName(sl.getBranch().getName())
                .currentQuantity(sl.getQuantity())
                .threshold(sl.getProduct().getLowStockThreshold())
                .build());
    }

    /**
     * Fast product lookup by barcode or SKU for POS terminal scanning.
     * Tries barcode first (more specific), then falls back to SKU.
     *
     * @param code The scanned barcode or SKU string
     * @return ProductResponse for the matched product
     * @throws ResourceNotFoundException if no product matches the code
     */
    @Transactional(readOnly = true)
    public ProductResponse lookupProductByCode(String code, boolean onlyActive) {
        UUID tenantId = TenantContext.getTenantId();

        // Try barcode first (most common for physical scanners)
        java.util.Optional<ProductEntity> productOpt = productRepository.findByBarcodeAndTenantId(code, tenantId);

        // Fallback to SKU if barcode didn't match
        if (productOpt.isEmpty()) {
            productOpt = productRepository.findBySkuAndTenantId(code, tenantId);
        }

        ProductEntity product = productOpt.orElseThrow(() -> 
            new com.lumora.pos.common.exception.ResourceNotFoundException("Product not found for code: " + code));

        if (onlyActive && !product.isActive()) {
            throw new BusinessException("Product is inactive and cannot be used for this operation.");
        }

        return mapToResponse(product);
    }

    @Transactional(readOnly = true)
    public ProductResponse getProductById(UUID id) {
        return productRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .map(this::mapToResponse)
                .orElseThrow(() -> new BusinessException("Product not found"));
    }

    @Transactional
    public ProductResponse createProduct(ProductRequest request) {
        UUID tenantId = TenantContext.getTenantId();

        long currentCount = productRepository.countByTenantId(tenantId);
        com.lumora.pos.superadmin.entity.TenantConfigurationEntity config = tenantConfigurationRepository.findByTenantId(tenantId)
                .orElseThrow(() -> new BusinessException("Tenant configuration not found"));
        if (currentCount >= config.getMaxProducts()) {
            throw new BusinessException("Subscription limit reached: Maximum products (" + config.getMaxProducts() + ") allowed.");
        }

        // 1. Check SKU Uniqueness
        if (request.getSku() != null && !request.getSku().isEmpty()) {
            if (productRepository.existsBySkuAndTenantId(request.getSku(), tenantId)) {
                throw new BusinessException("Product with SKU " + request.getSku() + " already exists");
            }
        } else {
            // Auto-generate SKU if needed
            request.setSku("PRD-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());
        }

        ProductEntity product = ProductEntity.builder()
                .name(request.getName())
                .sku(request.getSku())
                .barcode(request.getBarcode())
                .description(request.getDescription())
                .basePrice(request.getBasePrice())
                .costPrice(request.getCostPrice())
                .lowStockThreshold(request.getLowStockThreshold())
                .imageUrl(request.getImageUrl())
                .isActive(request.isActive())
                .trackStock(request.isTrackStock())
                .build();

        // 2. Set Category
        if (request.getCategoryId() != null) {
            CategoryEntity category = categoryRepository.findByIdAndTenantId(request.getCategoryId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Category not found"));
            product.setCategory(category);
        }

        // 3. Set Brand
        if (request.getBrandId() != null) {
            BrandEntity brand = brandRepository.findByIdAndTenantId(request.getBrandId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Brand not found"));
            product.setBrand(brand);
        }

        // 4. Set Primary Supplier (optional)
        if (request.getPrimarySupplierId() != null) {
            com.lumora.pos.supplier.entity.SupplierEntity supplier =
                supplierRepository.findByIdAndTenantId(request.getPrimarySupplierId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Supplier not found"));
            product.setPrimarySupplier(supplier);
        }

        product.setTenantId(tenantId);
        ProductEntity savedProduct = productRepository.save(product);

        // 4. Initialize Stock Level(s)
        //
        // Skipped entirely for a made-to-order product (V59). There is nothing to
        // count, and the default-branch path below throws "No branches found for
        // tenant" — a hard stop that must not apply to a dish cooked from
        // ingredients. An untracked product simply has no stock_levels row.
        if (savedProduct.isTrackStock()) {
            initializeStockLevels(savedProduct, request, tenantId);
        }

        ProductResponse response = mapToResponse(savedProduct);

        // Audit: Record new product creation
        auditService.logCreate("PRODUCT", response.getId(), response);

        return response;
    }

    /**
     * Creates the stock_levels row(s) a newly-created tracked product needs — one
     * per branch when the request names them, otherwise a single row at the default
     * branch carrying the requested opening quantity.
     *
     * <p>Only ever called for a product with {@code trackStock == true}: a
     * made-to-order item has no unit count, and the default-branch path here throws
     * when the tenant has no branches at all, which must not block creating a dish.
     */
    private void initializeStockLevels(ProductEntity savedProduct, ProductRequest request, UUID tenantId) {
        try {
            if (request.getBranchStockLevels() != null && !request.getBranchStockLevels().isEmpty()) {
                for (BranchStockRequest bsr : request.getBranchStockLevels()) {
                    com.lumora.pos.branch.entity.BranchEntity branch = branchRepository
                            .findByIdAndTenantId(bsr.getBranchId(), tenantId)
                            .orElseThrow(() -> new BusinessException("Branch not found: " + bsr.getBranchId()));

                    com.lumora.pos.inventory.entity.StockLevelEntity stockLevel = com.lumora.pos.inventory.entity.StockLevelEntity
                            .builder()
                            .product(savedProduct)
                            .branch(branch)
                            .quantity(bsr.getQuantity())
                            .build();
                    stockLevel.setTenantId(tenantId);
                    stockLevelRepository.save(stockLevel);
                }
                // Update product (Compatibility - Note: setStockQuantity is now derived)
                productRepository.save(savedProduct);
            } else {
                com.lumora.pos.branch.entity.BranchEntity defaultBranch = branchRepository
                        .findByIsDefaultTrueAndTenantId(tenantId)
                        .orElseGet(() -> branchRepository.findAllByTenantId(tenantId).stream().findFirst()
                                .orElseThrow(() -> new BusinessException("No branches found for tenant. Please create a branch first.")));

                com.lumora.pos.inventory.entity.StockLevelEntity stockLevel = com.lumora.pos.inventory.entity.StockLevelEntity
                        .builder()
                        .product(savedProduct)
                        .branch(defaultBranch)
                        .quantity(request.getStockQuantity() != null ? request.getStockQuantity() : 0)
                        .build();
                stockLevel.setTenantId(tenantId);
                stockLevelRepository.save(stockLevel);
            }
        } catch (Exception e) {
            if (e instanceof BusinessException)
                throw e;
            throw new BusinessException("Failed to initialize stock level: " + e.getMessage());
        }
    }

    @Transactional
    public ProductResponse updateProduct(UUID id, ProductRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        ProductEntity product = productRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Product not found"));

        // Audit: Capture state BEFORE mutations
        ProductResponse oldState = mapToResponse(product);

        // 1. Check SKU Uniqueness (if changed)
        if (request.getSku() != null && !request.getSku().equals(product.getSku())) {
            if (productRepository.existsBySkuAndTenantId(request.getSku(), tenantId)) {
                throw new BusinessException("Product with SKU " + request.getSku() + " already exists");
            }
        }

        product.setName(request.getName());
        product.setSku(request.getSku());
        product.setBarcode(request.getBarcode());
        product.setDescription(request.getDescription());
        product.setBasePrice(request.getBasePrice());
        product.setCostPrice(request.getCostPrice());
        product.setLowStockThreshold(request.getLowStockThreshold());
        product.setImageUrl(request.getImageUrl());
        product.setActive(request.isActive());
        // Switching tracking ON does not retro-create stock_levels rows — the product
        // simply reads 0 until stock is adjusted in, which is the same state as any
        // product that has sold out. Switching it OFF leaves existing rows alone so
        // the history stays intact and flipping back restores the old count.
        product.setTrackStock(request.isTrackStock());

        // 2. Update Category
        if (request.getCategoryId() != null) {
            CategoryEntity category = categoryRepository.findByIdAndTenantId(request.getCategoryId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Category not found"));
            product.setCategory(category);
        } else {
            product.setCategory(null);
        }

        // 3. Update Brand
        if (request.getBrandId() != null) {
            BrandEntity brand = brandRepository.findByIdAndTenantId(request.getBrandId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Brand not found"));
            product.setBrand(brand);
        } else {
            product.setBrand(null);
        }

        // 4. Update Primary Supplier (optional, nullable)
        if (request.getPrimarySupplierId() != null) {
            com.lumora.pos.supplier.entity.SupplierEntity supplier =
                supplierRepository.findByIdAndTenantId(request.getPrimarySupplierId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Supplier not found"));
            product.setPrimarySupplier(supplier);
        } else {
            product.setPrimarySupplier(null);
        }

        ProductResponse newState = mapToResponse(productRepository.save(product));

        // Audit: Record product update with before/after
        auditService.logUpdate("PRODUCT", id, oldState, newState);

        return newState;
    }

    @Transactional
    public void updateStock(UUID id, int quantityChange) {
        UUID tenantId = TenantContext.getTenantId();
        ProductEntity product = productRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Product not found"));

        // A made-to-order product has no stock to move (V59). Returning a dish
        // restores nothing, so this is a no-op rather than an error — the caller
        // (ReturnService) is processing a legitimate refund either way.
        if (!product.isTrackStock()) {
            return;
        }

        int oldQuantity = product.getStockQuantity();
        int newQuantity = oldQuantity + quantityChange;
        if (newQuantity < 0) {
            throw new BusinessException("Insufficient stock for product: " + product.getName());
        }

        // Update Product (Compatibility)
        productRepository.save(product);

        // Update StockLevel for Default Branch
        com.lumora.pos.branch.entity.BranchEntity defaultBranch = branchRepository
                .findByIsDefaultTrueAndTenantId(tenantId)
                .orElseGet(() -> branchRepository.findAllByTenantId(tenantId).stream().findFirst()
                        .orElseThrow(() -> new BusinessException("No branches found for tenant")));

        com.lumora.pos.inventory.entity.StockLevelEntity stockLevel = stockLevelRepository
                .findByProductIdAndBranchIdAndTenantId(product.getId(), defaultBranch.getId(), tenantId)
                .orElseGet(() -> {
                    com.lumora.pos.inventory.entity.StockLevelEntity sl = com.lumora.pos.inventory.entity.StockLevelEntity
                            .builder()
                            .product(product)
                            .branch(defaultBranch)
                            .quantity(0)
                            .build();
                    sl.setTenantId(tenantId);
                    return sl;
                });

        stockLevel.setQuantity(stockLevel.getQuantity() + quantityChange);
        stockLevelRepository.save(stockLevel);

        // Audit: Record stock adjustment
        auditService.log(AuditAction.STOCK_ADJUST, "PRODUCT", id,
                Map.of("stockQuantity", oldQuantity),
                Map.of("stockQuantity", newQuantity, "change", quantityChange));
    }

    @Transactional
    public void updateStockForBranch(UUID id, UUID branchId, int quantityChange, String reason) {
        UUID tenantId = TenantContext.getTenantId();
        ProductEntity product = productRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Product not found"));

        // A made-to-order product has no stock to move (V59). Without this the
        // return path would create a stock_levels row for something that never had
        // one, inventing inventory out of a refund.
        if (!product.isTrackStock()) {
            return;
        }

        int oldQuantity = product.getStockQuantity();
        int newQuantity = oldQuantity + quantityChange;

        // Update Product (Compatibility)
        productRepository.save(product);

        // Branch-specific Stock Check & Deduction (Pessimistic Lock)
        com.lumora.pos.inventory.entity.StockLevelEntity stockLevel = stockLevelRepository
                .findByProductAndBranchForUpdate(product.getId(), branchId, tenantId)
                .orElseGet(() -> {
                    com.lumora.pos.branch.entity.BranchEntity branch = branchRepository
                            .findByIdAndTenantId(branchId, tenantId)
                            .orElseThrow(() -> new BusinessException("Branch not found"));
                    com.lumora.pos.inventory.entity.StockLevelEntity sl = com.lumora.pos.inventory.entity.StockLevelEntity
                            .builder()
                            .product(product)
                            .branch(branch)
                            .quantity(0)
                            .build();
                    sl.setTenantId(tenantId);
                    return sl;
                });

        stockLevel.setQuantity(stockLevel.getQuantity() + quantityChange);
        stockLevelRepository.save(stockLevel);

        auditService.log(AuditAction.STOCK_ADJUST, "PRODUCT_BRANCH", id,
                Map.of("stockQuantity", oldQuantity),
                Map.of("stockQuantity", newQuantity, "change", quantityChange, "branchId", branchId, "reason", reason));
    }

    @Transactional
    public void deleteProduct(UUID id) {
        ProductEntity product = productRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Product not found"));

        // Audit: Record deleted product snapshot BEFORE deletion
        ProductResponse deletedState = mapToResponse(product);

        // Purchase-order items, return items, inventory adjustments and stock
        // transfers all hold a restricting FK to products(id), so a product with
        // any of that history cannot be removed. (Sales are exempt by design:
        // sale_items.product_id carries no FK so history survives deletion.)
        // Flush inside the method — otherwise the constraint would only fire at
        // commit, escaping this catch and surfacing as a 500.
        try {
            productRepository.delete(product);
            productRepository.flush();
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(
                    "This product has purchase, return or stock history and cannot be deleted. "
                            + "Deactivate it instead to hide it from the catalog.");
        }

        auditService.logDelete("PRODUCT", id, deletedState);
    }

    @Transactional
    public ProductResponse toggleStatus(UUID id) {
        UUID tenantId = TenantContext.getTenantId();
        ProductEntity product = productRepository.findByIdAndTenantId(id, tenantId)
                .orElseThrow(() -> new BusinessException("Product not found"));

        product.setActive(!product.isActive());
        ProductEntity updated = productRepository.save(product);

        auditService.log(AuditAction.UPDATE, "PRODUCT_STATUS", id,
                Map.of("isActive", !updated.isActive()),
                Map.of("isActive", updated.isActive()));

        return mapToResponse(updated);
    }

    /**
     * Sets the active flag for the given products in one transaction. Tenant-scoped
     * (foreign/unknown ids are skipped). Returns the number actually updated.
     */
    @Transactional
    public int bulkSetStatus(List<UUID> ids, boolean active) {
        UUID tenantId = TenantContext.getTenantId();
        List<ProductEntity> found = productRepository.findAllByIdInAndTenantId(ids, tenantId);
        for (ProductEntity product : found) {
            boolean was = product.isActive();
            product.setActive(active);
            if (was != active) {
                auditService.log(AuditAction.UPDATE, "PRODUCT_STATUS", product.getId(),
                        Map.of("isActive", was), Map.of("isActive", active));
            }
        }
        productRepository.saveAll(found);
        return found.size();
    }

    private ProductResponse mapToResponse(ProductEntity product) {
        List<com.lumora.pos.inventory.entity.StockLevelEntity> stockLevels = 
            stockLevelRepository.findAllByProductIdAndTenantId(product.getId(), product.getTenantId());
        return mapToResponse(product, stockLevels);
    }

    private ProductResponse mapToResponse(ProductEntity product, List<com.lumora.pos.inventory.entity.StockLevelEntity> stockLevels) {
        List<StockLevelResponse> stockLevelResponses = stockLevels.stream()
                .map(this::mapToStockLevelResponse)
                .toList();

        return ProductResponse.builder()
                .id(product.getId())
                .name(product.getName())
                .sku(product.getSku())
                .barcode(product.getBarcode())
                .description(product.getDescription())
                .basePrice(product.getBasePrice())
                .costPrice(product.getCostPrice())
                .stockQuantity(product.getStockQuantity())
                .lowStockThreshold(product.getLowStockThreshold())
                .imageUrl(product.getImageUrl())
                .isActive(product.isActive())
                .trackStock(product.isTrackStock())
                .categoryId(product.getCategory() != null ? product.getCategory().getId() : null)
                .categoryName(product.getCategory() != null ? product.getCategory().getName() : null)
                .brandId(product.getBrand() != null ? product.getBrand().getId() : null)
                .brandName(product.getBrand() != null ? product.getBrand().getName() : null)
                .primarySupplierId(product.getPrimarySupplier() != null ? product.getPrimarySupplier().getId() : null)
                .primarySupplierName(product.getPrimarySupplier() != null ? product.getPrimarySupplier().getName() : null)
                .stockLevels(stockLevelResponses)
                .createdAt(product.getCreatedAt())
                .updatedAt(product.getUpdatedAt())
                .build();
    }

    private StockLevelResponse mapToStockLevelResponse(com.lumora.pos.inventory.entity.StockLevelEntity sl) {
        return StockLevelResponse.builder()
                .id(sl.getId())
                .productId(sl.getProduct().getId())
                .branchId(sl.getBranch().getId())
                .branchName(sl.getBranch().getName())
                .quantity(sl.getQuantity())
                .build();
    }

    @Transactional(readOnly = true)
    public byte[] exportProductsToCsv() {
        UUID tenantId = TenantContext.getTenantId();
        List<ProductEntity> products = productRepository.findAllByTenantId(tenantId);
        
        try (ByteArrayOutputStream out = new ByteArrayOutputStream();
             CSVPrinter printer = new CSVPrinter(new OutputStreamWriter(out, StandardCharsets.UTF_8), 
                     CSVFormat.DEFAULT.builder().setHeader("Name", "SKU", "Barcode", "Description", "Base Price", "Cost Price", "Stock", "Low Stock Threshold", "Category", "Brand", "Is Active").build())) {
            
            for (ProductEntity p : products) {
                printer.printRecord(
                    p.getName(),
                    p.getSku(),
                    p.getBarcode() != null ? p.getBarcode() : "",
                    p.getDescription() != null ? p.getDescription() : "",
                    p.getBasePrice(),
                    p.getCostPrice(),
                    p.getStockQuantity(),
                    p.getLowStockThreshold(),
                    p.getCategory() != null ? p.getCategory().getName() : "",
                    p.getBrand() != null ? p.getBrand().getName() : "",
                    p.isActive()
                );
            }
            printer.flush();
            return out.toByteArray();
        } catch(Exception e) {
            throw new BusinessException("Failed to export products to CSV");
        }
    }

    @Transactional
    public int importProductsFromCsv(MultipartFile file) {
        UUID tenantId = TenantContext.getTenantId();
        int importedCount = 0;
        
        Map<String, CategoryEntity> categoryCache = new java.util.HashMap<>();
        Map<String, BrandEntity> brandCache = new java.util.HashMap<>();
        
        try (BufferedReader fileReader = new BufferedReader(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8));
             CSVParser csvParser = new CSVParser(fileReader, CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true).setIgnoreHeaderCase(true).setTrim(true).build())) {
            
            com.lumora.pos.branch.entity.BranchEntity defaultBranch = branchRepository
                    .findByIsDefaultTrueAndTenantId(tenantId)
                    .orElseGet(() -> branchRepository.findAllByTenantId(tenantId).stream().findFirst()
                            .orElseThrow(() -> new BusinessException("No branches found for tenant")));

            for (CSVRecord record : csvParser) {
                String name = record.get("name");
                String sku = record.get("sku");
                if (name == null || name.isEmpty() || sku == null || sku.isEmpty()) {
                    continue; // Skip invalid records
                }
                
                ProductEntity product = productRepository.findBySkuAndTenantId(sku, tenantId).orElse(new ProductEntity());
                
                product.setName(name);
                product.setSku(sku);
                product.setTenantId(tenantId);
                
                if (record.isMapped("barcode")) product.setBarcode(record.get("barcode"));
                if (record.isMapped("description")) product.setDescription(record.get("description"));
                if (record.isMapped("basePrice") && !record.get("basePrice").isEmpty()) product.setBasePrice(new BigDecimal(record.get("basePrice")));
                if (record.isMapped("costPrice") && !record.get("costPrice").isEmpty()) product.setCostPrice(new BigDecimal(record.get("costPrice")));

                int stockQty = 0;
                if (record.isMapped("stockQuantity") && !record.get("stockQuantity").isEmpty()) {
                    stockQty = Integer.parseInt(record.get("stockQuantity"));
                }
                
                boolean isNew = product.getId() == null;
                if (!isNew) {
                    // product.setStockQuantity(product.getStockQuantity()); // Removed – derived field
                } else {
                    long currentCount = productRepository.countByTenantId(tenantId);
                    com.lumora.pos.superadmin.entity.TenantConfigurationEntity config = tenantConfigurationRepository.findByTenantId(tenantId)
                            .orElseThrow(() -> new BusinessException("Tenant configuration not found"));
                    if (currentCount >= config.getMaxProducts()) {
                        throw new BusinessException("Subscription limit reached: Cannot import further products. Maximum allowed is " + config.getMaxProducts());
                    }
                    // product.setStockQuantity(stockQty); // Removed – derived field
                }
                
                if (record.isMapped("lowStockThreshold") && !record.get("lowStockThreshold").isEmpty()) {
                    product.setLowStockThreshold(Integer.parseInt(record.get("lowStockThreshold")));
                } else {
                    product.setLowStockThreshold(5);
                }

                if (record.isMapped("isActive") && !record.get("isActive").isEmpty()) {
                    product.setActive(Boolean.parseBoolean(record.get("isActive")));
                } else {
                    product.setActive(true);
                }

                // Process Category
                if (record.isMapped("category") && !record.get("category").isEmpty()) {
                    String catName = record.get("category");
                    CategoryEntity category = categoryCache.computeIfAbsent(catName, k -> {
                        return categoryRepository.findAllByTenantId(tenantId).stream()
                            .filter(c -> c.getName().equalsIgnoreCase(catName)).findFirst()
                            .orElseGet(() -> {
                                CategoryEntity newCat = CategoryEntity.builder().name(catName).build();
                                newCat.setTenantId(tenantId);
                                return categoryRepository.save(newCat);
                            });
                    });
                    product.setCategory(category);
                }
                
                // Process Brand
                if (record.isMapped("brand") && !record.get("brand").isEmpty()) {
                    String brandName = record.get("brand");
                    BrandEntity brand = brandCache.computeIfAbsent(brandName, k -> {
                        return brandRepository.findAllByTenantId(tenantId).stream()
                            .filter(b -> b.getName().equalsIgnoreCase(brandName)).findFirst()
                            .orElseGet(() -> {
                                BrandEntity newBrand = BrandEntity.builder().name(brandName).build();
                                newBrand.setTenantId(tenantId);
                                return brandRepository.save(newBrand);
                            });
                    });
                    product.setBrand(brand);
                }
                
                // Base price is required (NOT NULL). Skip rows that don't supply one
                // rather than failing the whole import with a constraint violation.
                if (product.getBasePrice() == null) {
                    continue;
                }

                product = productRepository.save(product);

                if (isNew) {
                    com.lumora.pos.inventory.entity.StockLevelEntity stockLevel = com.lumora.pos.inventory.entity.StockLevelEntity
                            .builder()
                            .product(product)
                            .branch(defaultBranch)
                            .quantity(stockQty)
                            .build();
                    stockLevel.setTenantId(tenantId);
                    stockLevelRepository.save(stockLevel);
                }
                
                importedCount++;
            }
            auditService.log(AuditAction.UPDATE, "PRODUCT_IMPORT", null, null, Map.of("importedCount", importedCount));
            return importedCount;
        } catch(Exception e) {
            throw new BusinessException("Failed to import products from CSV: " + e.getMessage());
        }
    }
}
