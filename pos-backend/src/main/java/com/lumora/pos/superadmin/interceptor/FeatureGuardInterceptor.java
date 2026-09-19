package com.lumora.pos.superadmin.interceptor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lumora.pos.common.dto.ApiResponse;
import com.lumora.pos.superadmin.entity.TenantConfigurationEntity;
import com.lumora.pos.superadmin.repository.TenantConfigurationRepository;
import com.lumora.pos.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Global interceptor that governs API access based on a tenant's subscription features.
 *
 * Runs AFTER the JwtAuthenticationFilter (so TenantContext is populated).
 * Intercepts requests, matches the URI to specific feature tags, and throws a 403 Forbidden
 * if the tenant's `features_enabled` JSONB array lacks the required tag.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FeatureGuardInterceptor implements HandlerInterceptor {

    private final TenantConfigurationRepository tenantConfigurationRepository;
    private final ObjectMapper objectMapper;

    // Map of URI path prefixes to their required feature flags
    private static final Map<String, String> FEATURE_ROUTES = new HashMap<>();

    static {
        FEATURE_ROUTES.put("/api/v1/purchase-orders", "PURCHASE_ORDERS");
        FEATURE_ROUTES.put("/api/v1/stock-transfers", "STOCK_TRANSFERS");
        FEATURE_ROUTES.put("/api/v1/returns", "RETURNS");
        FEATURE_ROUTES.put("/api/v1/taxes", "TAX_CONFIG");
        FEATURE_ROUTES.put("/api/v1/time-records", "TIME_CLOCK");
        FEATURE_ROUTES.put("/api/v1/reports/profitability", "ADVANCED_ANALYTICS");
        FEATURE_ROUTES.put("/api/v1/reports/inventory-valuation", "ADVANCED_ANALYTICS");
        // "/api/v1/expense" matches both /expenses and /expense-categories
        FEATURE_ROUTES.put("/api/v1/expense", "EXPENSES");
        FEATURE_ROUTES.put("/api/v1/finance", "FINANCIAL_REPORTS");
        FEATURE_ROUTES.put("/api/v1/credit", "STORE_CREDIT");
        // Core features (SALES, INVENTORY, REPORTS, CUSTOMERS, EMPLOYEES)
        // are granted to all plans by default, but we could add them here if needed.
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        UUID tenantId = TenantContext.getTenantId();

        // If no tenant context is set (e.g. public endpoint or Super Admin request), allow it.
        if (tenantId == null) {
            return true;
        }

        String requestURI = request.getRequestURI();

        // Find the required feature for this URI prefix
        String requiredFeature = null;
        for (Map.Entry<String, String> entry : FEATURE_ROUTES.entrySet()) {
            if (requestURI.startsWith(entry.getKey())) {
                requiredFeature = entry.getValue();
                break;
            }
        }

        // If the route doesn't require a specific feature flag, allow access
        if (requiredFeature == null) {
            return true;
        }

        // Query the tenant's configuration
        TenantConfigurationEntity config = tenantConfigurationRepository.findByTenantId(tenantId).orElse(null);

        // Fail-safe: if config is missing, default to secure (deny access)
        if (config == null || !config.hasFeature(requiredFeature)) {
            log.warn("Access denied: Tenant {} attempted to access {}, but lacks feature {}",
                    tenantId, requestURI, requiredFeature);
            sendForbiddenResponse(response, requiredFeature);
            return false;
        }

        return true;
    }

    /**
     * Helper to write a clean standard JSON ApiResponse for 403 Forbidden.
     */
    private void sendForbiddenResponse(HttpServletResponse response, String requiredFeature) throws IOException {
        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);

        ApiResponse<Object> errorResponse = ApiResponse.error(
                "Feature not enabled for your subscription plan. Required feature: " + requiredFeature);

        response.getWriter().write(objectMapper.writeValueAsString(errorResponse));
        response.getWriter().flush();
    }
}
