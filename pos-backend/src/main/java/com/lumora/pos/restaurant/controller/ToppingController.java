package com.lumora.pos.restaurant.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.restaurant.dto.ToppingDtos;
import com.lumora.pos.restaurant.service.ToppingService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Topping authoring, plus the read the till uses when a dish is tapped.
 *
 * <p>Authoring is ADMIN/MANAGER only — {@code price_mode} decides whether a
 * cashier may type a price at all, so letting a cashier edit it would defeat the
 * control it exists to provide. The read endpoints include CASHIER, since the
 * till has to ask the question.
 */
@RestController
@RequestMapping("/api/v1/restaurant")
@RequiredArgsConstructor
public class ToppingController {

    private final ToppingService toppingService;

    // ---- Groups -------------------------------------------------------

    @GetMapping("/topping-groups")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<List<ToppingDtos.GroupResponse>>> listGroups() {
        return ResponseEntity.ok(ApiResponse.<List<ToppingDtos.GroupResponse>>builder()
                .success(true)
                .message("Topping groups retrieved")
                .data(toppingService.listGroups())
                .build());
    }

    @PostMapping("/topping-groups")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<ToppingDtos.GroupResponse>> createGroup(
            @Valid @RequestBody ToppingDtos.GroupRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.<ToppingDtos.GroupResponse>builder()
                        .success(true)
                        .message("Topping group created")
                        .data(toppingService.createGroup(request))
                        .build());
    }

    @PutMapping("/topping-groups/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<ToppingDtos.GroupResponse>> updateGroup(
            @PathVariable UUID id, @Valid @RequestBody ToppingDtos.GroupRequest request) {
        return ResponseEntity.ok(ApiResponse.<ToppingDtos.GroupResponse>builder()
                .success(true)
                .message("Topping group updated")
                .data(toppingService.updateGroup(id, request))
                .build());
    }

    @DeleteMapping("/topping-groups/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<Void>> deleteGroup(@PathVariable UUID id) {
        toppingService.deleteGroup(id);
        return ResponseEntity.ok(ApiResponse.<Void>builder()
                .success(true)
                .message("Topping group deleted")
                .build());
    }

    // ---- Toppings -----------------------------------------------------

    @PostMapping("/toppings")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<ToppingDtos.ToppingResponse>> createTopping(
            @Valid @RequestBody ToppingDtos.ToppingUpsertRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.<ToppingDtos.ToppingResponse>builder()
                        .success(true)
                        .message("Topping created")
                        .data(toppingService.createTopping(request))
                        .build());
    }

    @PutMapping("/toppings/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<ToppingDtos.ToppingResponse>> updateTopping(
            @PathVariable UUID id, @Valid @RequestBody ToppingDtos.ToppingUpsertRequest request) {
        return ResponseEntity.ok(ApiResponse.<ToppingDtos.ToppingResponse>builder()
                .success(true)
                .message("Topping updated")
                .data(toppingService.updateTopping(id, request))
                .build());
    }

    @DeleteMapping("/toppings/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<Void>> deleteTopping(@PathVariable UUID id) {
        toppingService.deleteTopping(id);
        return ResponseEntity.ok(ApiResponse.<Void>builder()
                .success(true)
                .message("Topping deleted")
                .build());
    }

    // ---- What the till asks -------------------------------------------

    @GetMapping("/products/with-toppings")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<List<UUID>>> productIdsWithToppings() {
        return ResponseEntity.ok(ApiResponse.<List<UUID>>builder()
                .success(true)
                .message("Products with add-ons retrieved")
                .data(toppingService.productIdsWithToppings())
                .build());
    }

    @GetMapping("/products/{productId}/topping-groups")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<List<ToppingDtos.GroupResponse>>> groupsForProduct(
            @PathVariable UUID productId) {
        return ResponseEntity.ok(ApiResponse.<List<ToppingDtos.GroupResponse>>builder()
                .success(true)
                .message("Topping groups retrieved")
                .data(toppingService.groupsForProduct(productId))
                .build());
    }

    @PutMapping("/products/{productId}/topping-groups")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<Void>> setGroupsForProduct(
            @PathVariable UUID productId, @RequestBody List<UUID> groupIds) {
        toppingService.setGroupsForProduct(productId, groupIds);
        return ResponseEntity.ok(ApiResponse.<Void>builder()
                .success(true)
                .message("Topping groups updated")
                .build());
    }
}
