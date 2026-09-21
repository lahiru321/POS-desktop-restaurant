package com.lumora.pos.superadmin.enums;

/**
 * Feature flags that can be enabled/disabled per tenant.
 * Stored as a JSONB array in tenant_configurations.features_enabled.
 *
 * The FeatureGuardInterceptor (Step 3) will use these tags to
 * enforce feature access at the API level.
 */
public enum Feature {

    // --- Core Features (all plans) ---
    SALES,
    INVENTORY,
    REPORTS,
    CUSTOMERS,
    EMPLOYEES,

    // --- Medium Business Features ---
    PURCHASE_ORDERS,
    RETURNS,
    TAX_CONFIG,
    TIME_CLOCK,
    EXPENSES,

    // --- Enterprise Features ---
    STOCK_TRANSFERS,
    ADVANCED_ANALYTICS,
    API_ACCESS,
    FINANCIAL_REPORTS,

    // --- Store credit (route-gated on /api/v1/credit) ---
    STORE_CREDIT,

    // --- Restaurant (route-gated on /api/v1/restaurant) ---
    // Grants the API. Whether this business is a restaurant is the separate
    // restaurantMode setting in tenants.settings.
    RESTAURANT,

    // --- Multi-branch (Medium / Enterprise) ---
    // Restricts each user to their assigned branch(es). Behavioural, not route-gated:
    // enforced by BranchAccessGuard, not the FeatureGuardInterceptor.
    BRANCH_RESTRICTIONS
}
