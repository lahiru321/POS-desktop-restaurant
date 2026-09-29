package com.lumora.pos.restaurant.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.restaurant.dto.KitchenTicketDtos;
import com.lumora.pos.restaurant.service.KitchenTicketService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * What the kitchen was told, and whether it heard. Tickets are created by the
 * order endpoints (fire, void); this controller only reads them, records the
 * till's print outcome, and hands a stored sheet back for reprinting.
 *
 * <p>All till work, so CASHIER is included throughout: whoever is standing at
 * the till when the kitchen printer jams is the one who has to deal with it.
 */
@RestController
@RequestMapping("/api/v1/restaurant/kitchen-tickets")
@RequiredArgsConstructor
public class KitchenTicketController {

    private final KitchenTicketService ticketService;

    /**
     * With {@code orderId}: every ticket on that order, in round order. Without:
     * the tenant's unresolved tickets — failed, or stuck pending — which is what
     * the till's red badge polls.
     */
    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<List<KitchenTicketDtos.KitchenTicketResponse>>> list(
            @RequestParam(required = false) UUID orderId) {
        return ResponseEntity.ok(ApiResponse.<List<KitchenTicketDtos.KitchenTicketResponse>>builder()
                .success(true)
                .message("Kitchen tickets retrieved")
                .data(orderId != null ? ticketService.listForOrder(orderId) : ticketService.listUnresolved())
                .build());
    }

    @PostMapping("/{id}/ack")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<KitchenTicketDtos.KitchenTicketResponse>> acknowledge(
            @PathVariable UUID id, @Valid @RequestBody KitchenTicketDtos.AckRequest request) {
        return ResponseEntity.ok(ApiResponse.<KitchenTicketDtos.KitchenTicketResponse>builder()
                .success(true)
                .message("Print outcome recorded")
                .data(ticketService.acknowledge(id, request))
                .build());
    }

    @PostMapping("/{id}/reprint")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<KitchenTicketDtos.KitchenTicketResponse>> reprint(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.<KitchenTicketDtos.KitchenTicketResponse>builder()
                .success(true)
                .message("Ticket ready to reprint")
                .data(ticketService.reprint(id))
                .build());
    }
}
