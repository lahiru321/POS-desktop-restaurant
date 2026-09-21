package com.lumora.pos.restaurant.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.restaurant.dto.OrderDtos;
import com.lumora.pos.restaurant.service.RestaurantOrderService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Open tabs. Every operation here is till work, so CASHIER is included
 * throughout — a server who cannot open a tab cannot do their job.
 *
 * <p>Voiding a whole order stays ADMIN/MANAGER: it writes off everything on the
 * tab at once, which is the one action on this controller a shift supervisor
 * should have to authorise.
 */
@RestController
@RequestMapping("/api/v1/restaurant/orders")
@RequiredArgsConstructor
public class RestaurantOrderController {

    private final RestaurantOrderService orderService;

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<List<OrderDtos.OrderResponse>>> listOpen() {
        return ResponseEntity.ok(ApiResponse.<List<OrderDtos.OrderResponse>>builder()
                .success(true)
                .message("Open orders retrieved")
                .data(orderService.listOpen())
                .build());
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<OrderDtos.OrderResponse>> get(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.<OrderDtos.OrderResponse>builder()
                .success(true)
                .message("Order retrieved")
                .data(orderService.get(id))
                .build());
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<OrderDtos.OrderResponse>> open(
            @Valid @RequestBody OrderDtos.OpenOrderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.<OrderDtos.OrderResponse>builder()
                        .success(true)
                        .message("Order opened")
                        .data(orderService.open(request))
                        .build());
    }

    @PostMapping("/{id}/items")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<OrderDtos.OrderResponse>> addItems(
            @PathVariable UUID id, @Valid @RequestBody OrderDtos.AddItemsRequest request) {
        return ResponseEntity.ok(ApiResponse.<OrderDtos.OrderResponse>builder()
                .success(true)
                .message("Items added")
                .data(orderService.addItems(id, request))
                .build());
    }

    @PatchMapping("/{id}/items/{itemId}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<OrderDtos.OrderResponse>> updateItem(
            @PathVariable UUID id, @PathVariable UUID itemId,
            @Valid @RequestBody OrderDtos.UpdateItemRequest request) {
        return ResponseEntity.ok(ApiResponse.<OrderDtos.OrderResponse>builder()
                .success(true)
                .message("Line updated")
                .data(orderService.updateItem(id, itemId, request))
                .build());
    }

    @PostMapping("/{id}/items/{itemId}/void")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<OrderDtos.OrderResponse>> voidItem(
            @PathVariable UUID id, @PathVariable UUID itemId,
            @RequestBody(required = false) OrderDtos.VoidItemRequest request) {
        return ResponseEntity.ok(ApiResponse.<OrderDtos.OrderResponse>builder()
                .success(true)
                .message("Line voided")
                .data(orderService.voidItem(id, itemId, request))
                .build());
    }

    @PostMapping("/{id}/settle")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<OrderDtos.SettleResponse>> settle(
            @PathVariable UUID id, @Valid @RequestBody OrderDtos.SettleRequest request) {
        return ResponseEntity.ok(ApiResponse.<OrderDtos.SettleResponse>builder()
                .success(true)
                .message("Order settled")
                .data(orderService.settle(id, request))
                .build());
    }

    @PostMapping("/{id}/void")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<OrderDtos.OrderResponse>> voidOrder(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.<OrderDtos.OrderResponse>builder()
                .success(true)
                .message("Order voided")
                .data(orderService.voidOrder(id))
                .build());
    }
}
