package com.lumora.pos.inventory.service;

import com.lumora.pos.inventory.dto.bulk.BulkProductImportResponse;
import com.lumora.pos.inventory.entity.BrandEntity;
import com.lumora.pos.inventory.entity.CategoryEntity;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.BrandRepository;
import com.lumora.pos.inventory.repository.CategoryRepository;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVPrinter;
import org.apache.commons.csv.CSVRecord;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.inventory.entity.StockLevelEntity;
import com.lumora.pos.inventory.repository.StockLevelRepository;
import java.util.Collections;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.Reader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class BulkProductService {

    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;
    private final BrandRepository brandRepository;
    private final BranchRepository branchRepository;
    private final StockLevelRepository stockLevelRepository;

    @Transactional
    public BulkProductImportResponse importProducts(InputStream inputStream) {
        UUID tenantId = TenantContext.getTenantId();
        BulkProductImportResponse response = new BulkProductImportResponse();
        List<ProductEntity> productsToSave = new ArrayList<>();
        List<Integer> stockQuantities = new ArrayList<>(); // To track stock for second pass

        // Pre-load meta-data caches (N+1 resolution)
        Map<String, CategoryEntity> categoryCache = categoryRepository.findAllByTenantId(tenantId).stream()
                .collect(Collectors.toMap(c -> c.getName().toLowerCase(), c -> c, (a, b) -> a));

        Map<String, BrandEntity> brandCache = brandRepository.findAllByTenantId(tenantId).stream()
                .collect(Collectors.toMap(b -> b.getName().toLowerCase(), b -> b, (a, b) -> a));

        // Get first available branch for initial stock seeding
        BranchEntity defaultBranch = branchRepository.findAllByTenantId(tenantId).stream()
                .findFirst()
                .orElseThrow(() -> new RuntimeException("No branch found for tenant. Cannot seed stock."));

        CSVFormat csvFormat = CSVFormat.DEFAULT.builder()
                .setHeader()
                .setSkipHeaderRecord(true)
                .setIgnoreHeaderCase(true)
                .setTrim(true)
                .build();

        try (Reader reader = new InputStreamReader(inputStream, StandardCharsets.UTF_8);
                CSVParser csvParser = csvFormat.parse(reader)) {

            List<CSVRecord> records = csvParser.getRecords();
            response.setTotalRows(records.size());

            int rowNum = 1;
            for (CSVRecord record : records) {
                rowNum++;
                try {
                    validateRecord(record, response, rowNum, tenantId);

                    ProductEntity product = mapToEntityWithCaching(record, tenantId, categoryCache, brandCache);
                    productsToSave.add(product);
                    
                    // Store quantity for subsequent stock level creation
                    int stockQty = record.isMapped("stockQuantity") ? Integer.parseInt(record.get("stockQuantity")) : 0;
                    stockQuantities.add(stockQty);

                    response.setSuccessCount(response.getSuccessCount() + 1);
                } catch (Exception e) {
                    response.setFailureCount(response.getFailureCount() + 1);
                    response.getErrors().add(new BulkProductImportResponse.ImportError(
                            rowNum, "General", e.getMessage()));
                }
            }

            if (!productsToSave.isEmpty()) {
                // Bulk save products
                List<ProductEntity> savedProducts = productRepository.saveAll(productsToSave);
                
                // Bulk seed stocks (ARCH-002)
                List<StockLevelEntity> stockLevels = new ArrayList<>();
                for (int i = 0; i < savedProducts.size(); i++) {
                    if (!savedProducts.get(i).isTrackStock()) {
                        continue; // made to order: no stock row (V59)
                    }
                    stockLevels.add(StockLevelEntity.builder()
                            .product(savedProducts.get(i))
                            .branch(defaultBranch)
                            .quantity(stockQuantities.get(i))
                            .build());
                }
                stockLevelRepository.saveAll(stockLevels);
            }

        } catch (Exception e) {
            log.error("Failed to parse CSV", e);
            throw new RuntimeException("Failed to parse CSV: " + e.getMessage());
        }

        return response;
    }

    private void validateRecord(CSVRecord record, BulkProductImportResponse response, int rowNum, UUID tenantId) {
        String name = record.get("name");
        String sku = record.get("sku");
        String basePrice = record.get("basePrice");
        String stockQuantity = record.get("stockQuantity");

        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Product name is required");
        }

        if (sku != null && !sku.isBlank()) {
            if (productRepository.existsBySkuAndTenantId(sku, tenantId)) {
                throw new IllegalArgumentException("SKU already exists: " + sku);
            }
        }

        try {
            new BigDecimal(basePrice);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid base price format: " + basePrice);
        }

        try {
            Integer.parseInt(stockQuantity);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid stock quantity format: " + stockQuantity);
        }
    }

    @Transactional(readOnly = true)
    public void exportProducts(PrintWriter writer) {
        UUID tenantId = TenantContext.getTenantId();
        List<ProductEntity> products = productRepository.findAllByTenantId(tenantId);

        CSVFormat csvFormat = CSVFormat.DEFAULT.builder()
                .setHeader("name", "sku", "barcode", "description", "category", "brand", "basePrice", "costPrice",
                        "stockQuantity", "lowStockThreshold")
                .build();

        try (CSVPrinter csvPrinter = new CSVPrinter(writer, csvFormat)) {
            for (ProductEntity product : products) {
                csvPrinter.printRecord(
                        product.getName(),
                        product.getSku(),
                        product.getBarcode(),
                        product.getDescription(),
                        product.getCategory() != null ? product.getCategory().getName() : "",
                        product.getBrand() != null ? product.getBrand().getName() : "",
                        product.getBasePrice(),
                        product.getCostPrice() != null ? product.getCostPrice() : BigDecimal.ZERO,
                        product.getStockQuantity(),
                        product.getLowStockThreshold());
            }
            csvPrinter.flush();
        } catch (Exception e) {
            log.error("Failed to export products to CSV", e);
            throw new RuntimeException("Failed to export products: " + e.getMessage());
        }
    }

    /** ProductService.importProductsFromCsv's rule: an explicit column wins,
     *  otherwise only a row that brings stock is counted in units. */
    private static boolean trackStock(CSVRecord record) {
        if (record.isMapped("trackStock") && !record.get("trackStock").isBlank()) {
            return Boolean.parseBoolean(record.get("trackStock"));
        }
        return record.isMapped("stockQuantity") && !record.get("stockQuantity").isBlank()
                && Integer.parseInt(record.get("stockQuantity")) > 0;
    }

    private ProductEntity mapToEntityWithCaching(CSVRecord record, UUID tenantId,
            Map<String, CategoryEntity> catCache, Map<String, BrandEntity> brandCache) {
        
        String categoryName = record.isMapped("category") ? record.get("category").toLowerCase() : "";
        CategoryEntity category = catCache.get(categoryName);

        String brandName = record.isMapped("brand") ? record.get("brand").toLowerCase() : "";
        BrandEntity brand = brandCache.get(brandName);

        ProductEntity product = ProductEntity.builder()
                .name(record.get("name"))
                .sku(record.get("sku"))
                .barcode(record.get("barcode"))
                .description(record.get("description"))
                .basePrice(new BigDecimal(record.get("basePrice")))
                .costPrice(record.isMapped("costPrice") && !record.get("costPrice").isBlank()
                        ? new BigDecimal(record.get("costPrice"))
                        : BigDecimal.ZERO)
                .lowStockThreshold(record.isMapped("lowStockThreshold") && !record.get("lowStockThreshold").isBlank()
                        ? Integer.parseInt(record.get("lowStockThreshold"))
                        : 0)
                .category(category)
                .brand(brand)
                .isActive(true)
                .trackStock(trackStock(record))
                .build();
        product.setTenantId(tenantId);
        return product;
    }
}
