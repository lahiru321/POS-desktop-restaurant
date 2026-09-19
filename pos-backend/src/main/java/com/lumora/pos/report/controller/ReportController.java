package com.lumora.pos.report.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.report.dto.ReportDtos.*;
import com.lumora.pos.report.service.ReportService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/v1/reports")
@RequiredArgsConstructor
public class ReportController {

    private final ReportService reportService;

    @GetMapping("/sales")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<Page<SalesReportRecord>>> getSalesReport(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end,
            @RequestParam(required = false) java.util.UUID branchId,
            Pageable pageable) {

        return ResponseEntity.ok(ApiResponse.success(
                reportService.getSalesReport(start, end, branchId, pageable),
                "Sales report retrieved successfully"));
    }

    @GetMapping("/inventory-valuation")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<InventoryValuationReport>> getInventoryValuation(
            @RequestParam(required = false) java.util.UUID branchId) {
        return ResponseEntity.ok(ApiResponse.success(
                reportService.getInventoryValuation(branchId),
                "Inventory valuation retrieved successfully"));
    }

    @GetMapping("/employee-performance")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<Page<EmployeePerformanceRecord>>> getEmployeePerformance(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end,
            @RequestParam(required = false) java.util.UUID branchId,
            Pageable pageable) {
        return ResponseEntity.ok(ApiResponse.success(
                reportService.getEmployeePerformance(start, end, branchId, pageable),
                "Employee performance report retrieved successfully"));
    }

    @GetMapping("/top-customers")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<Page<TopCustomerRecord>>> getTopCustomers(Pageable pageable) {
        return ResponseEntity.ok(ApiResponse.success(
                reportService.getTopCustomers(pageable),
                "Top customers retrieved successfully"));
    }

    @GetMapping("/customer-credit")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<Page<CustomerCreditRecord>>> getCustomerCredit(Pageable pageable) {
        return ResponseEntity.ok(ApiResponse.success(
                reportService.getCustomerCredit(pageable),
                "Customer credit report retrieved successfully"));
    }

    @GetMapping("/tax-summary")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<TaxSummaryReport>> getTaxSummary(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end) {
        return ResponseEntity.ok(ApiResponse.success(
                reportService.getTaxSummary(start, end),
                "Tax summary retrieved successfully"));
    }

    @GetMapping("/profitability")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<ProfitabilityReport>> getProfitabilityReport(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end,
            @RequestParam(required = false) java.util.UUID branchId,
            Pageable pageable) {
        return ResponseEntity.ok(ApiResponse.success(
                reportService.getProfitabilityReport(start, end, branchId, pageable),
                "Profitability report retrieved successfully"));
    }

    @GetMapping("/sold-items-by-supplier")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<SoldItemsBySupplierReport>> getSoldItemsBySupplier(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end) {
        return ResponseEntity.ok(ApiResponse.success(
                reportService.getSoldItemsBySupplier(start, end),
                "Sold items by supplier retrieved successfully"));
    }

    @GetMapping("/stock-variance")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<StockVarianceReport>> getStockVariance(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end,
            @RequestParam(required = false) java.util.UUID branchId) {
        return ResponseEntity.ok(ApiResponse.success(
                reportService.getStockVariance(start, end, branchId),
                "Stock variance report retrieved successfully"));
    }

    @GetMapping("/cash-reconciliation")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<ApiResponse<Page<CashReconciliationRecord>>> getCashReconciliation(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime start,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) LocalDateTime end,
            @RequestParam(required = false) java.util.UUID branchId,
            Pageable pageable) {
        return ResponseEntity.ok(ApiResponse.success(
                reportService.getCashReconciliation(start, end, branchId, pageable),
                "Cash reconciliation report retrieved successfully"));
    }
}
