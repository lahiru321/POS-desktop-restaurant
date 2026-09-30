package com.lumora.pos.licensing.controller;

import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.licensing.service.LicenseGuard;
import com.lumora.pos.licensing.service.LicensePolicy;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The license as the till should show it: nothing, "expires in 12 days", or "the
 * till stops on 7 Oct". Desktop only — the hosted product has no license file, so
 * this does not exist there and the web client shows no banner.
 */
@RestController
@RequestMapping("/api/v1/license")
@Profile("desktop")
@RequiredArgsConstructor
public class LicenseStatusController {

    private final LicenseGuard licenseGuard;

    /** Any signed-in user: the cashier at the till is who sees the warning first. */
    @GetMapping("/status")
    public ResponseEntity<ApiResponse<LicensePolicy.Status>> status() {
        return ResponseEntity.ok(ApiResponse.<LicensePolicy.Status>builder()
                .success(true)
                .message("License status")
                .data(licenseGuard.status())
                .build());
    }
}
