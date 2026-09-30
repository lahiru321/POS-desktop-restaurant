package com.lumora.pos.restaurant.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.restaurant.service.KitchenStationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Read-only: stations are set on products and categories. Listed for Settings →
 * Hardware, where each till maps a station to a printer, and to suggest
 * existing names in the product and category forms. Station names are not
 * sensitive, so every role that can reach either screen may read them.
 */
@RestController
@RequestMapping("/api/v1/restaurant/kitchen-stations")
@RequiredArgsConstructor
public class KitchenStationController {

    private final KitchenStationService stationService;

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER','INVENTORY_MANAGER')")
    public ResponseEntity<ApiResponse<List<String>>> list() {
        return ResponseEntity.ok(ApiResponse.<List<String>>builder()
                .success(true)
                .message("Kitchen stations retrieved")
                .data(stationService.listStations())
                .build());
    }
}
