package com.lumora.pos.ingredient.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.ingredient.dto.IngredientAdjustRequest;
import com.lumora.pos.ingredient.dto.IngredientMovementResponse;
import com.lumora.pos.ingredient.dto.IngredientRequest;
import com.lumora.pos.ingredient.dto.IngredientResponse;
import com.lumora.pos.ingredient.service.IngredientService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * What the kitchen buys: the catalogue, stock per branch, wastage and stock counts.
 * Stock arrives by receiving a purchase order ({@code /purchase-orders/{id}/receive}).
 */
@RestController
@RequestMapping("/api/v1/ingredients")
@RequiredArgsConstructor
@PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'INVENTORY_MANAGER')")
public class IngredientController {

    private final IngredientService ingredientService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<IngredientResponse>>> list(
            @RequestParam(required = false) UUID branchId,
            @RequestParam(defaultValue = "false") boolean includeInactive) {
        return ResponseEntity.ok(ApiResponse.success(
                ingredientService.list(branchId, includeInactive), "Ingredients retrieved successfully"));
    }

    @GetMapping("/low-stock")
    public ResponseEntity<ApiResponse<List<IngredientResponse>>> lowStock(
            @RequestParam(required = false) UUID branchId) {
        return ResponseEntity.ok(ApiResponse.success(
                ingredientService.lowStock(branchId), "Low-stock ingredients retrieved successfully"));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<IngredientResponse>> get(
            @PathVariable UUID id,
            @RequestParam(required = false) UUID branchId) {
        return ResponseEntity.ok(ApiResponse.success(
                ingredientService.get(id, branchId), "Ingredient retrieved successfully"));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<IngredientResponse>> create(@Valid @RequestBody IngredientRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(ingredientService.create(request), "Ingredient created successfully"));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<IngredientResponse>> update(
            @PathVariable UUID id,
            @Valid @RequestBody IngredientRequest request) {
        return ResponseEntity.ok(ApiResponse.success(
                ingredientService.update(id, request), "Ingredient updated successfully"));
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<ApiResponse<IngredientResponse>> toggleStatus(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.success(
                ingredientService.toggleStatus(id), "Ingredient status updated successfully"));
    }

    @PostMapping("/{id}/adjust")
    public ResponseEntity<ApiResponse<IngredientResponse>> adjust(
            @PathVariable UUID id,
            @Valid @RequestBody IngredientAdjustRequest request) {
        return ResponseEntity.ok(ApiResponse.success(
                ingredientService.adjust(id, request), "Stock updated"));
    }

    @GetMapping("/{id}/movements")
    public ResponseEntity<ApiResponse<Page<IngredientMovementResponse>>> movements(
            @PathVariable UUID id,
            @RequestParam(required = false) UUID branchId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        PageRequest pageRequest = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), 100));
        return ResponseEntity.ok(ApiResponse.success(
                ingredientService.movements(id, branchId, pageRequest), "Stock history retrieved successfully"));
    }
}
