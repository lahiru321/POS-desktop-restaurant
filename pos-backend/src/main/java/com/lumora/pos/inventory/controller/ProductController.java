package com.lumora.pos.inventory.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.common.dto.BulkStatusRequest;
import com.lumora.pos.inventory.dto.LowStockResponse;
import com.lumora.pos.inventory.dto.ProductRequest;
import com.lumora.pos.inventory.dto.ProductResponse;
import com.lumora.pos.inventory.service.ProductService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/products")
@RequiredArgsConstructor
public class ProductController {

        private final ProductService productService;

        @GetMapping
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'CASHIER', 'INVENTORY_MANAGER')")
        public ResponseEntity<ApiResponse<Page<ProductResponse>>> getAllProducts(
                        @RequestParam(required = false) String search,
                        @RequestParam(required = false) UUID categoryId,
                        @RequestParam(required = false) UUID brandId,
                        @RequestParam(required = false) Boolean isActive,
                        Pageable pageable) {
                return ResponseEntity.ok(ApiResponse.success(
                                productService.getAllProducts(search, categoryId, brandId, isActive, pageable),
                                "Products fetched successfully"));
        }

        /**
         * Fast product lookup by barcode or SKU — used by POS terminal barcode scanner.
         * Tries barcode match first, then falls back to SKU.
         */
        @GetMapping("/lookup")
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'CASHIER')")
        public ResponseEntity<ApiResponse<ProductResponse>> lookupByCode(
                        @RequestParam String code,
                        @RequestParam(defaultValue = "false") boolean onlyActive) {
                return ResponseEntity.ok(ApiResponse.success(
                                productService.lookupProductByCode(code, onlyActive),
                                "Product found"));
        }

        @GetMapping("/{id}")
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'CASHIER', 'INVENTORY_MANAGER')")
        public ResponseEntity<ApiResponse<ProductResponse>> getProductById(@PathVariable UUID id) {
                return ResponseEntity.ok(ApiResponse.success(
                                productService.getProductById(id),
                                "Product fetched successfully"));
        }

        @PostMapping
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'INVENTORY_MANAGER')")
        public ResponseEntity<ApiResponse<ProductResponse>> createProduct(@Valid @RequestBody ProductRequest request) {
                return ResponseEntity.status(201).body(ApiResponse.success(
                                productService.createProduct(request),
                                "Product created successfully"));
        }

        @PutMapping("/{id}")
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'INVENTORY_MANAGER')")
        public ResponseEntity<ApiResponse<ProductResponse>> updateProduct(
                        @PathVariable UUID id,
                        @Valid @RequestBody ProductRequest request) {
                return ResponseEntity.ok(ApiResponse.success(
                                productService.updateProduct(id, request),
                                "Product updated successfully"));
        }

        @PatchMapping("/{id}/stock")
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'INVENTORY_MANAGER')")
        public ResponseEntity<ApiResponse<Void>> updateStock(
                        @PathVariable UUID id,
                        @RequestParam int quantityChange) {
                productService.updateStock(id, quantityChange);
                return ResponseEntity.ok(ApiResponse.<Void>builder()
                                .success(true)
                                .message("Stock updated successfully")
                                .build());
        }

        @DeleteMapping("/{id}")
        @PreAuthorize("hasRole('ADMIN')")
        public ResponseEntity<ApiResponse<Void>> deleteProduct(@PathVariable UUID id) {
                productService.deleteProduct(id);
                return ResponseEntity.ok(ApiResponse.<Void>builder()
                                .success(true)
                                .message("Product deleted successfully")
                                .build());
        }

        @PatchMapping("/{id}/status")
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'INVENTORY_MANAGER')")
        public ResponseEntity<ApiResponse<ProductResponse>> toggleStatus(@PathVariable UUID id) {
                return ResponseEntity.ok(ApiResponse.success(
                                productService.toggleStatus(id),
                                "Product status updated successfully"));
        }

        @PostMapping("/bulk-status")
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'INVENTORY_MANAGER')")
        public ResponseEntity<ApiResponse<Integer>> bulkSetStatus(@Valid @RequestBody BulkStatusRequest request) {
                int updated = productService.bulkSetStatus(request.getIds(), request.isActive());
                String state = request.isActive() ? "activated" : "deactivated";
                return ResponseEntity.ok(ApiResponse.success(updated, updated + " product(s) " + state));
        }

        @GetMapping("/low-stock")
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'INVENTORY_MANAGER')")
        public ResponseEntity<ApiResponse<Page<LowStockResponse>>> getLowStock(
                        @RequestParam(required = false) UUID branchId,
                        Pageable pageable) {
                return ResponseEntity.ok(ApiResponse.success(
                                productService.getLowStockAlerts(branchId, pageable),
                                "Low stock alerts fetched successfully"));
        }

        @PostMapping("/import")
        @PreAuthorize("hasAnyRole('ADMIN', 'INVENTORY_MANAGER')")
        public ResponseEntity<ApiResponse<Integer>> importProducts(@RequestParam("file") org.springframework.web.multipart.MultipartFile file) {
                int count = productService.importProductsFromCsv(file);
                return ResponseEntity.ok(ApiResponse.success(count, "Imported " + count + " menu items"));
        }

        @GetMapping("/export")
        @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'INVENTORY_MANAGER')")
        public ResponseEntity<byte[]> exportProducts() {
                byte[] csvData = productService.exportProductsToCsv();
                return ResponseEntity.ok()
                        .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"menu_items.csv\"")
                        .header(org.springframework.http.HttpHeaders.CONTENT_TYPE, "text/csv; charset=UTF-8")
                        .body(csvData);
        }
}
