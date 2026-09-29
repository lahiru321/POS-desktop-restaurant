package com.lumora.pos.superadmin.service;

import com.lumora.pos.audit.AuditAction;
import com.lumora.pos.auth.entity.RoleEntity;
import com.lumora.pos.config.BillingProperties;
import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.RoleRepository;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.common.exception.ResourceNotFoundException;
import com.lumora.pos.superadmin.dto.*;
import com.lumora.pos.superadmin.entity.TenantConfigurationEntity;
import com.lumora.pos.superadmin.entity.TenantEntity;
import com.lumora.pos.superadmin.enums.PlanTier;
import com.lumora.pos.superadmin.repository.TenantConfigurationRepository;
import com.lumora.pos.superadmin.repository.TenantRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Core service for the Super Admin to govern all tenants.
 * Operates cross-tenant without the standard TenantContext filter.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SuperAdminTenantService {

    private final TenantRepository tenantRepository;
    private final TenantConfigurationRepository tenantConfigurationRepository;
    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;
    private final JdbcTemplate jdbcTemplate;
    private final SuperAdminAuditService auditService;
    private final BillingProperties billingProperties;
    private final com.lumora.pos.auth.repository.RefreshTokenRepository refreshTokenRepository;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    /**
     * List all tenants with pagination and optional search/status filters.
     */
    @Transactional(readOnly = true)
    public Page<TenantSummaryResponse> listTenants(String search, Boolean isActive, Pageable pageable) {
        String safeSearch = (search != null) ? search : "";
        Page<TenantEntity> tenants = tenantRepository.searchTenants(safeSearch, isActive, pageable);

        return tenants.map(tenant -> {
            TenantConfigurationEntity config = tenantConfigurationRepository
                    .findByTenantId(tenant.getId())
                    .orElse(TenantConfigurationEntity.builder()
                        .tenantId(tenant.getId())
                        .isActive(tenant.isActive())
                        .build());

            return TenantSummaryResponse.builder()
                    .id(tenant.getId())
                    .name(tenant.getName())
                    .domain(tenant.getDomain())
                    .planTier(config.getPlanTier())
                    .isActive(config.isActive())
                    .isSubscriptionExpired(config.isSubscriptionExpired())
                    .subscriptionEnd(config.getSubscriptionEnd())
                    .maxLocations(config.getMaxLocations())
                    .maxUsers(config.getMaxUsers())
                    .maxProducts(config.getMaxProducts())
                    .createdAt(tenant.getCreatedAt())
                    .build();
        });
    }

    /**
     * Get full details of a single tenant, including their configuration limits.
     */
    @Transactional(readOnly = true)
    public TenantDetailResponse getTenantDetail(UUID tenantId) {
        TenantEntity tenant = tenantRepository.findById(tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Tenant not found"));

        TenantConfigurationEntity config = tenantConfigurationRepository.findByTenantId(tenantId)
                .orElseThrow(() -> new BusinessException("Tenant configuration missing for " + tenantId));

        // Compute live usage stats via JdbcTemplate
        Long activeLocations = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM branches WHERE tenant_id = ? AND is_active = true",
                Long.class, tenantId);
        if (activeLocations == null) activeLocations = 0L;

        Long activeUsers = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM users WHERE tenant_id = ? AND is_active = true",
                Long.class, tenantId);
        if (activeUsers == null) activeUsers = 0L;

        Long totalProducts = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM products WHERE tenant_id = ?",
                Long.class, tenantId);
        if (totalProducts == null) totalProducts = 0L;

        Long totalOrders = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM sales WHERE tenant_id = ?",
                Long.class, tenantId);
        if (totalOrders == null) totalOrders = 0L;

        java.math.BigDecimal lifetimeRevenue = jdbcTemplate.queryForObject(
                "SELECT SUM(total_amount) FROM sales WHERE tenant_id = ?",
                java.math.BigDecimal.class, tenantId);
        if (lifetimeRevenue == null) lifetimeRevenue = java.math.BigDecimal.ZERO;

        TenantUsageStatsDto usageStats = TenantUsageStatsDto.builder()
                .activeLocations(activeLocations)
                .activeUsers(activeUsers)
                .totalProducts(totalProducts)
                .totalOrders(totalOrders)
                .lifetimeRevenue(lifetimeRevenue)
                .build();

        return TenantDetailResponse.builder()
                .id(tenant.getId())
                .name(tenant.getName())
                .domain(tenant.getDomain())
                .tenantActive(tenant.isActive())
                .createdAt(tenant.getCreatedAt())
                .addressLine1(tenant.getAddressLine1())
                .addressLine2(tenant.getAddressLine2())
                .phone(tenant.getPhone())
                .logoUrl(tenant.getLogoDataUri())
                .receiptFooter(parseReceiptFooter(tenant.getSettings()))
                .configId(config.getId())
                .planTier(config.getPlanTier())
                .maxLocations(config.getMaxLocations())
                .maxUsers(config.getMaxUsers())
                .maxProducts(config.getMaxProducts())
                .featuresEnabled(config.getFeaturesEnabled())
                .configActive(config.isActive())
                .subscriptionStart(config.getSubscriptionStart())
                .subscriptionEnd(config.getSubscriptionEnd())
                .isSubscriptionExpired(config.isSubscriptionExpired())
                .notes(config.getNotes())
                .configCreatedAt(config.getCreatedAt())
                .configUpdatedAt(config.getUpdatedAt())
                .usage(usageStats)
                .build();
    }

    /**
     * Provisions a brand new tenant, sets up their configuration, copies system
     * permissions/roles, and creates their first active ADMIN user.
     */
    @Transactional
    public TenantDetailResponse createTenant(CreateTenantRequest request) {
        if (request.getDomain() != null && tenantRepository.existsByDomain(request.getDomain())) {
            throw new BusinessException("Domain is already in use by another tenant");
        }

        // 1. Create the base Tenant record
        TenantEntity tenant = TenantEntity.builder()
                .name(request.getName())
                .domain(request.getDomain())
                .build();
        tenant = tenantRepository.saveAndFlush(tenant);

        // 2. Parse initial Plan Tier
        PlanTier tier = PlanTier.SMALL_BUSINESS;
        if (request.getPlanTier() != null) {
            try {
                tier = PlanTier.valueOf(request.getPlanTier().toUpperCase());
            } catch (IllegalArgumentException e) {
                log.warn("Invalid plan tier provided: {}, defaulting to SMALL_BUSINESS", request.getPlanTier());
            }
        }

        // Set defaults based on tier
        int maxLocs = 1, maxUsrs = 5, maxProds = 500;
        List<String> features = List.of("SALES", "INVENTORY", "REPORTS", "CUSTOMERS", "EMPLOYEES");

        if (tier == PlanTier.MEDIUM_BUSINESS) {
            maxLocs = 3; maxUsrs = 15; maxProds = 5000;
            features = List.of("SALES", "INVENTORY", "REPORTS", "CUSTOMERS", "EMPLOYEES", "PURCHASE_ORDERS", "RETURNS", "TAX_CONFIG", "EXPENSES", "FINANCIAL_REPORTS");
        } else if (tier == PlanTier.ENTERPRISE) {
            maxLocs = 999; maxUsrs = 999; maxProds = 999999;
            features = List.of("SALES", "INVENTORY", "REPORTS", "CUSTOMERS", "EMPLOYEES", "PURCHASE_ORDERS", "STOCK_TRANSFERS", "RETURNS", "TAX_CONFIG", "TIME_CLOCK", "ADVANCED_ANALYTICS", "API_ACCESS", "EXPENSES", "FINANCIAL_REPORTS");
        }

        // 3. Create the configuration record
        TenantConfigurationEntity config = TenantConfigurationEntity.builder()
                .tenantId(tenant.getId())
                .planTier(tier)
                .maxLocations(maxLocs)
                .maxUsers(maxUsrs)
                .maxProducts(maxProds)
                .featuresEnabled(features)
                .notes(request.getNotes())
                .build();
        config = tenantConfigurationRepository.saveAndFlush(config);

        // 4. Clone System Roles & Permissions from Demo Tenant (a0000000-0000-0000-0000-000000000001)
        cloneSystemRolesAndPermissions(tenant.getId());

        // 5. Create Default Main Branch
        String sqlBranch = 
            "INSERT INTO branches (id, tenant_id, name, address, phone_number, is_active, is_default, created_at, updated_at) " +
            "VALUES (uuid_generate_v4(), ?, 'Main Branch', 'Headquarters', 'N/A', true, true, NOW(), NOW())";
        jdbcTemplate.update(sqlBranch, tenant.getId());

        // 6. Create Initial Admin User
        RoleEntity adminRole = roleRepository.findByNameAndTenantId("ADMIN", tenant.getId())
                .orElseThrow(() -> new BusinessException("Failed to clone ADMIN role for new tenant"));

        UserEntity adminUser = UserEntity.builder()
                .email(request.getAdminEmail().toLowerCase().trim())
                .passwordHash(passwordEncoder.encode(request.getAdminPassword()))
                .firstName(request.getAdminFirstName())
                .lastName(request.getAdminLastName())
                .roles(java.util.Set.of(adminRole))
                // The super admin's chosen password is single-use: the tenant admin
                // is forced to set their own on first login, so the operator never
                // retains a working credential for the tenant.
                .mustChangePassword(true)
                .build();
        adminUser.setTenantId(tenant.getId());
        userRepository.save(adminUser);

        log.info("Provisioned new tenant: {} ({}) with initial admin {}", tenant.getName(), tenant.getId(), adminUser.getEmail());

        auditService.logTenantMutation(AuditAction.TENANT_PROVISIONED, tenant.getId(), null,
                Map.of(
                        "name", tenant.getName(),
                        "domain", String.valueOf(tenant.getDomain()),
                        "planTier", tier.name(),
                        "adminEmail", adminUser.getEmail()
                ));

        return getTenantDetail(tenant.getId());
    }

    /**
     * Desktop first-run bootstrap. Provisions the single local tenant + its admin
     * from the seed file the Electron launcher wrote. Mirrors {@link #createTenant}
     * but with two deliberate differences:
     *   1. the admin password is ALREADY bcrypt-hashed by the launcher, so it is
     *      persisted verbatim — never re-encoded (that would double-hash it); and
     *   2. {@code mustChangePassword} is false — the store owner picked the password
     *      themselves in the wizard, so there is no operator credential to rotate.
     * No super-admin audit entry is written: there is no authenticated principal
     * during an {@code ApplicationRunner} at startup.
     */
    @Transactional
    public void provisionFromSeed(TenantSeed seed) {
        final String domain = "LOCAL";

        TenantEntity tenant = TenantEntity.builder()
                .name(seed.tenantName())
                .domain(domain)
                .build();
        tenant = tenantRepository.saveAndFlush(tenant);

        // A desktop install is a single paid till — give it the full feature set.
        List<String> features = List.of("SALES", "INVENTORY", "REPORTS", "CUSTOMERS", "EMPLOYEES",
                "PURCHASE_ORDERS", "STOCK_TRANSFERS", "RETURNS", "TAX_CONFIG", "TIME_CLOCK",
                "ADVANCED_ANALYTICS", "API_ACCESS", "EXPENSES", "FINANCIAL_REPORTS", "STORE_CREDIT");

        TenantConfigurationEntity config = TenantConfigurationEntity.builder()
                .tenantId(tenant.getId())
                .planTier(PlanTier.ENTERPRISE)
                .maxLocations(999)
                .maxUsers(999)
                .maxProducts(999999)
                .featuresEnabled(features)
                .build();
        tenantConfigurationRepository.saveAndFlush(config);

        cloneSystemRolesAndPermissions(tenant.getId());

        jdbcTemplate.update(
                "INSERT INTO branches (id, tenant_id, name, address, phone_number, is_active, is_default, created_at, updated_at) " +
                "VALUES (uuid_generate_v4(), ?, 'Main Branch', 'Headquarters', 'N/A', true, true, NOW(), NOW())",
                tenant.getId());

        RoleEntity adminRole = roleRepository.findByNameAndTenantId("ADMIN", tenant.getId())
                .orElseThrow(() -> new BusinessException("Failed to clone ADMIN role for desktop tenant"));

        UserEntity adminUser = UserEntity.builder()
                .email(seed.adminEmail().toLowerCase().trim())
                .passwordHash(seed.adminPasswordBcrypt()) // already bcrypt — do NOT re-encode
                .firstName("Admin")
                .lastName("User")
                .roles(java.util.Set.of(adminRole))
                .mustChangePassword(false)
                .build();
        adminUser.setTenantId(tenant.getId());
        userRepository.save(adminUser);

        // V1 always seeds an active "Demo Business" tenant. Deactivate it so this
        // deployment has exactly ONE active tenant — required by single-tenant PIN
        // resolution (resolveSingleTenantId) and so the LOCAL store is unambiguous.
        tenantRepository.findById(UUID.fromString("a0000000-0000-0000-0000-000000000001"))
                .ifPresent(demo -> {
                    demo.setActive(false);
                    tenantRepository.save(demo);
                    log.info("Desktop bootstrap: deactivated seed demo tenant");
                });

        log.info("Desktop bootstrap: provisioned tenant '{}' ({}) with admin {}",
                tenant.getName(), tenant.getId(), adminUser.getEmail());
    }

    /**
     * Lists all users for a tenant (the super admin's tenant detail → Users tab).
     * Doubles as the "forgot email" lookup path. Cross-tenant read — no TenantContext.
     */
    @Transactional(readOnly = true)
    public List<TenantUserResponse> listTenantUsers(UUID tenantId) {
        if (!tenantRepository.existsById(tenantId)) {
            throw new ResourceNotFoundException("Tenant not found");
        }
        return userRepository.findAllByTenantIdOrderByCreatedAtDesc(tenantId).stream()
                .map(u -> TenantUserResponse.builder()
                        .id(u.getId())
                        .email(u.getEmail())
                        .firstName(u.getFirstName())
                        .lastName(u.getLastName())
                        .phone(u.getPhone())
                        .active(u.isActive())
                        .mustChangePassword(u.isMustChangePassword())
                        .roles(u.getRoles().stream().map(RoleEntity::getName).collect(java.util.stream.Collectors.toList()))
                        .lastLoginAt(u.getLastLoginAt())
                        .createdAt(u.getCreatedAt())
                        .build())
                .collect(java.util.stream.Collectors.toList());
    }

    /**
     * Super admin resets a tenant user's password (e.g. the tenant admin locked
     * themselves out). The new password is single-use — the user must change it
     * on next login — and all their refresh tokens are revoked.
     */
    @Transactional
    public void resetTenantUserPassword(UUID tenantId, UUID userId, String newPassword) {
        UserEntity user = userRepository.findByIdAndTenantId(userId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("User not found in this tenant"));

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        user.setMustChangePassword(true);
        userRepository.save(user);

        refreshTokenRepository.revokeAllByUserId(userId);

        auditService.logTenantMutation(AuditAction.TENANT_USER_PASSWORD_RESET, tenantId, null,
                Map.of("userId", userId.toString(), "email", user.getEmail()));
    }

    private String parseReceiptFooter(String settingsJson) {
        if (settingsJson == null || settingsJson.isBlank()) return null;
        try {
            Map<String, Object> settings = objectMapper.readValue(settingsJson,
                    new com.fasterxml.jackson.core.type.TypeReference<>() {});
            Object footer = settings.get("receiptFooter");
            return footer != null ? footer.toString() : null;
        } catch (Exception e) {
            log.warn("Could not parse tenant settings JSON for {}: {}", "receiptFooter", e.getMessage());
            return null;
        }
    }

    /**
     * Update an existing tenant's configuration (upgrade tier, change limits/features).
     */
    @Transactional
    @CacheEvict(value = "tenantConfigs", key = "#tenantId")
    public TenantDetailResponse updateTenantConfiguration(UUID tenantId, TenantConfigurationRequest request) {
        TenantConfigurationEntity config = tenantConfigurationRepository.findByTenantId(tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Tenant configuration not found"));

        Map<String, Object> before = snapshotConfig(config);

        config.setPlanTier(request.getPlanTier());
        config.setMaxLocations(request.getMaxLocations());
        config.setMaxUsers(request.getMaxUsers());
        config.setMaxProducts(request.getMaxProducts());
        config.setFeaturesEnabled(request.getFeaturesEnabled());
        config.setActive(request.isActive());
        config.setSubscriptionEnd(request.getSubscriptionEnd());
        config.setNotes(request.getNotes());

        tenantConfigurationRepository.save(config);

        log.info("Updated configuration for tenant: {}", tenantId);
        auditService.logTenantMutation(AuditAction.TENANT_CONFIG_UPDATED, tenantId, before, snapshotConfig(config));
        return getTenantDetail(tenantId);
    }

    /**
     * Suspend a tenant (their users will not be able to log in or use the API).
     */
    @Transactional
    @CacheEvict(value = "tenantConfigs", key = "#tenantId")
    public TenantDetailResponse suspendTenant(UUID tenantId) {
        boolean wasActiveBefore = tenantConfigurationRepository.findByTenantId(tenantId)
                .map(TenantConfigurationEntity::isActive)
                .orElse(true);

        TenantConfigurationEntity config = tenantConfigurationRepository.findByTenantId(tenantId)
                .orElseGet(() -> {
                    log.info("Provisioning missing configuration during SUSPENSION for tenant: {}", tenantId);
                    return TenantConfigurationEntity.builder()
                            .tenantId(tenantId)
                            .planTier(PlanTier.SMALL_BUSINESS)
                            .isActive(false)
                            .build();
                });

        config.setActive(false);
        tenantConfigurationRepository.save(config);

        // Also update parent tenant table
        tenantRepository.findById(tenantId).ifPresent(tenant -> {
            tenant.setActive(false);
            tenantRepository.save(tenant);
        });

        log.warn("SUSPENDED tenant: {}", tenantId);
        auditService.logTenantMutation(AuditAction.TENANT_SUSPENDED, tenantId,
                Map.of("isActive", wasActiveBefore),
                Map.of("isActive", false));
        return getTenantDetail(tenantId);
    }

    /**
     * Reactivate a suspended tenant.
     */
    @Transactional
    @CacheEvict(value = "tenantConfigs", key = "#tenantId")
    public TenantDetailResponse activateTenant(UUID tenantId) {
        boolean wasActiveBefore = tenantConfigurationRepository.findByTenantId(tenantId)
                .map(TenantConfigurationEntity::isActive)
                .orElse(false);

        TenantConfigurationEntity config = tenantConfigurationRepository.findByTenantId(tenantId)
                .orElseGet(() -> {
                    log.info("Provisioning missing configuration during ACTIVATION for tenant: {}", tenantId);
                    return TenantConfigurationEntity.builder()
                            .tenantId(tenantId)
                            .planTier(PlanTier.SMALL_BUSINESS)
                            .isActive(true)
                            .build();
                });

        config.setActive(true);
        tenantConfigurationRepository.save(config);

        tenantRepository.findById(tenantId).ifPresent(tenant -> {
            tenant.setActive(true);
            tenantRepository.save(tenant);
        });

        log.info("ACTIVATED tenant: {}", tenantId);
        auditService.logTenantMutation(AuditAction.TENANT_REACTIVATED, tenantId,
                Map.of("isActive", wasActiveBefore),
                Map.of("isActive", true));
        return getTenantDetail(tenantId);
    }

    /**
     * Get platform-wide aggregated statistics for the Super Admin dashboard.
     */
    @Transactional(readOnly = true)
    public PlatformStatsResponse getPlatformStats() {
        long totalTenants = tenantRepository.count();
        long activeTenants = tenantConfigurationRepository.countByIsActive(true);
        long suspendedTenants = tenantConfigurationRepository.countByIsActive(false);

        long small = tenantConfigurationRepository.countByPlanTier(PlanTier.SMALL_BUSINESS);
        long medium = tenantConfigurationRepository.countByPlanTier(PlanTier.MEDIUM_BUSINESS);
        long enterprise = tenantConfigurationRepository.countByPlanTier(PlanTier.ENTERPRISE);

        // Count expired subscriptions natively via query
        Long expiredCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM tenant_configurations WHERE subscription_end IS NOT NULL AND subscription_end < NOW()",
                Long.class
        );

        // P3.1 — Monthly active users: distinct tenant users that touched
        // audit_log in the last 30 days. user_id can be null for system
        // actions, so we exclude those.
        Long mau = jdbcTemplate.queryForObject(
                "SELECT COUNT(DISTINCT user_id) FROM audit_log " +
                "WHERE user_id IS NOT NULL AND created_at >= NOW() - INTERVAL '30 days'",
                Long.class
        );

        // P3.1 — Churn this calendar month: TENANT_SUSPENDED rows in
        // super_admin_audit_log since the first of the month.
        Long churn = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM super_admin_audit_log " +
                "WHERE action = 'TENANT_SUSPENDED' AND created_at >= date_trunc('month', NOW())",
                Long.class
        );

        // P3.1 — Plan motion: TENANT_CONFIG_UPDATED events where the
        // planTier field actually changed. Uses JSONB ->> 'planTier'.
        Long planChanges = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM super_admin_audit_log " +
                "WHERE action = 'TENANT_CONFIG_UPDATED' " +
                "  AND created_at >= NOW() - INTERVAL '30 days' " +
                "  AND old_value->>'planTier' IS NOT NULL " +
                "  AND new_value->>'planTier' IS NOT NULL " +
                "  AND old_value->>'planTier' <> new_value->>'planTier'",
                Long.class
        );

        // Projected MRR from configurable plan prices (app.billing.plan-prices).
        java.math.BigDecimal projectedMrr =
                billingProperties.priceFor(PlanTier.SMALL_BUSINESS).multiply(java.math.BigDecimal.valueOf(small))
                        .add(billingProperties.priceFor(PlanTier.MEDIUM_BUSINESS).multiply(java.math.BigDecimal.valueOf(medium)))
                        .add(billingProperties.priceFor(PlanTier.ENTERPRISE).multiply(java.math.BigDecimal.valueOf(enterprise)));

        return PlatformStatsResponse.builder()
                .totalTenants(totalTenants)
                .activeTenants(activeTenants)
                .suspendedTenants(suspendedTenants)
                .smallBusinessCount(small)
                .mediumBusinessCount(medium)
                .enterpriseCount(enterprise)
                .expiredSubscriptions(expiredCount != null ? expiredCount : 0)
                .projectedMrr(projectedMrr)
                .monthlyActiveUsers(mau != null ? mau : 0)
                .churnThisMonth(churn != null ? churn : 0)
                .planChanges30d(planChanges != null ? planChanges : 0)
                .build();
    }

    /**
     * Compact, JSON-friendly snapshot of a tenant configuration for audit
     * before/after diffs. Avoids serializing the JPA entity directly so
     * lazy proxies don't blow up Jackson and the diff stays readable.
     */
    private Map<String, Object> snapshotConfig(TenantConfigurationEntity config) {
        return Map.of(
                "planTier",         String.valueOf(config.getPlanTier()),
                "maxLocations",     config.getMaxLocations(),
                "maxUsers",         config.getMaxUsers(),
                "maxProducts",      config.getMaxProducts(),
                "featuresEnabled",  config.getFeaturesEnabled() != null ? config.getFeaturesEnabled() : List.of(),
                "isActive",         config.isActive(),
                "subscriptionEnd",  String.valueOf(config.getSubscriptionEnd()),
                "notes",            String.valueOf(config.getNotes())
        );
    }

    /**
     * Helper cleanly copying all permissions and roles from the Demo tenant to the new tenant.
     */
    private void cloneSystemRolesAndPermissions(UUID newTenantId) {
        UUID demoTenantId = UUID.fromString("a0000000-0000-0000-0000-000000000001");

        // 1. Copy permissions
        String sqlPermissions = 
            "INSERT INTO permissions (id, tenant_id, name, module, description, created_at) " +
            "SELECT uuid_generate_v4(), ?, name, module, description, NOW() " +
            "FROM permissions WHERE tenant_id = ?";
        jdbcTemplate.update(sqlPermissions, newTenantId, demoTenantId);

        // 2. Copy roles
        String sqlRoles = 
            "INSERT INTO roles (id, tenant_id, name, description, is_system, created_at) " +
            "SELECT uuid_generate_v4(), ?, name, description, is_system, NOW() " +
            "FROM roles WHERE tenant_id = ?";
        jdbcTemplate.update(sqlRoles, newTenantId, demoTenantId);

        // 3. Map new Role IDs to new Permission IDs by matching by name.
        String sqlRolePermissions = 
            "INSERT INTO role_permissions (role_id, permission_id) " +
            "SELECT r_new.id, p_new.id " +
            "FROM role_permissions rp_old " +
            "JOIN roles r_old ON rp_old.role_id = r_old.id " +
            "JOIN permissions p_old ON rp_old.permission_id = p_old.id " +
            "JOIN roles r_new ON r_new.name = r_old.name AND r_new.tenant_id = ? " +
            "JOIN permissions p_new ON p_new.name = p_old.name AND p_new.tenant_id = ? " +
            "WHERE r_old.tenant_id = ?";
        jdbcTemplate.update(sqlRolePermissions, newTenantId, newTenantId, demoTenantId);
    }
}
