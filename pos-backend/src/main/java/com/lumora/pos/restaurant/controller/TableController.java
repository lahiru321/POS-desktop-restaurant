package com.lumora.pos.restaurant.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.restaurant.dto.TableDtos;
import com.lumora.pos.restaurant.service.TableService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * Floor-plan authoring, plus the read the floor view polls.
 *
 * <p>Authoring is ADMIN/MANAGER only — the layout is a setup decision, not a
 * service-time one. The reads include CASHIER, because seating a table is the
 * first thing a server does.
 */
@RestController
@RequestMapping("/api/v1/restaurant")
@RequiredArgsConstructor
public class TableController {

    private final TableService tableService;

    // ---- Areas --------------------------------------------------------

    @GetMapping("/areas")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<List<TableDtos.AreaResponse>>> listAreas() {
        return ResponseEntity.ok(ApiResponse.<List<TableDtos.AreaResponse>>builder()
                .success(true)
                .message("Areas retrieved")
                .data(tableService.listAreas())
                .build());
    }

    @PostMapping("/areas")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<TableDtos.AreaResponse>> createArea(
            @Valid @RequestBody TableDtos.AreaRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.<TableDtos.AreaResponse>builder()
                        .success(true)
                        .message("Area created")
                        .data(tableService.createArea(request))
                        .build());
    }

    @PutMapping("/areas/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<TableDtos.AreaResponse>> updateArea(
            @PathVariable UUID id, @Valid @RequestBody TableDtos.AreaRequest request) {
        return ResponseEntity.ok(ApiResponse.<TableDtos.AreaResponse>builder()
                .success(true)
                .message("Area updated")
                .data(tableService.updateArea(id, request))
                .build());
    }

    @DeleteMapping("/areas/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<Void>> deleteArea(@PathVariable UUID id) {
        tableService.deleteArea(id);
        return ResponseEntity.ok(ApiResponse.<Void>builder()
                .success(true)
                .message("Area deleted")
                .build());
    }

    // ---- Tables -------------------------------------------------------

    @GetMapping("/tables")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','CASHIER')")
    public ResponseEntity<ApiResponse<List<TableDtos.TableResponse>>> listTables(
            @RequestParam(required = false) UUID areaId) {
        return ResponseEntity.ok(ApiResponse.<List<TableDtos.TableResponse>>builder()
                .success(true)
                .message("Tables retrieved")
                .data(tableService.listTables(areaId))
                .build());
    }

    @PostMapping("/tables")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<TableDtos.TableResponse>> createTable(
            @Valid @RequestBody TableDtos.TableRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.<TableDtos.TableResponse>builder()
                        .success(true)
                        .message("Table created")
                        .data(tableService.createTable(request))
                        .build());
    }

    @PutMapping("/tables/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<TableDtos.TableResponse>> updateTable(
            @PathVariable UUID id, @Valid @RequestBody TableDtos.TableRequest request) {
        return ResponseEntity.ok(ApiResponse.<TableDtos.TableResponse>builder()
                .success(true)
                .message("Table updated")
                .data(tableService.updateTable(id, request))
                .build());
    }

    @DeleteMapping("/tables/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    public ResponseEntity<ApiResponse<Void>> deleteTable(@PathVariable UUID id) {
        tableService.deleteTable(id);
        return ResponseEntity.ok(ApiResponse.<Void>builder()
                .success(true)
                .message("Table deleted")
                .build());
    }
}
