package com.lumora.pos.credit.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.credit.dto.CreditSummaryResponse;
import com.lumora.pos.credit.dto.CreditTransactionResponse;
import com.lumora.pos.credit.dto.RepaymentRequest;
import com.lumora.pos.credit.service.CreditService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Customer store-credit endpoints. Access is additionally gated by the
 * {@code STORE_CREDIT} feature flag via {@code FeatureGuardInterceptor}, which
 * returns 403 for tenants without the subscription feature.
 */
@RestController
@RequestMapping("/api/v1/credit")
@RequiredArgsConstructor
public class CreditController {

    private final CreditService creditService;

    /** A customer's current credit position (limit / balance / available). */
    @GetMapping("/customers/{customerId}/summary")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'CASHIER')")
    public ResponseEntity<ApiResponse<CreditSummaryResponse>> getSummary(@PathVariable UUID customerId) {
        return ResponseEntity.ok(ApiResponse.success(
                creditService.getSummary(customerId), "Credit summary fetched successfully"));
    }

    /** A customer's credit ledger (charge/repayment history), newest first. */
    @GetMapping("/customers/{customerId}")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'CASHIER')")
    public ResponseEntity<ApiResponse<Page<CreditTransactionResponse>>> getLedger(
            @PathVariable UUID customerId, Pageable pageable) {
        return ResponseEntity.ok(ApiResponse.success(
                creditService.getLedger(customerId, pageable), "Credit ledger fetched successfully"));
    }

    /** Record a customer paying down their outstanding credit balance. */
    @PostMapping("/customers/{customerId}/repay")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'CASHIER')")
    public ResponseEntity<ApiResponse<CreditSummaryResponse>> repay(
            @PathVariable UUID customerId, @Valid @RequestBody RepaymentRequest request) {
        return ResponseEntity.ok(ApiResponse.success(
                creditService.recordRepayment(customerId, request), "Repayment recorded successfully"));
    }
}
