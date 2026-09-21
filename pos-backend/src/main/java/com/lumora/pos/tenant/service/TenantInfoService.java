package com.lumora.pos.tenant.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lumora.pos.common.exception.ResourceNotFoundException;
import com.lumora.pos.superadmin.entity.TenantEntity;
import com.lumora.pos.superadmin.repository.TenantRepository;
import com.lumora.pos.tenant.TenantContext;
import com.lumora.pos.loyalty.dto.LoyaltyConfig;
import com.lumora.pos.tenant.dto.TenantInfoDtos.TenantInfoResponse;
import com.lumora.pos.tenant.dto.TenantInfoDtos.TenantInfoUpdateRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class TenantInfoService {

    /** Covers pre-filled on a new dine-in tab when the tenant has never set one. */
    private static final int DEFAULT_COVERS = 2;
    private static final int MIN_COVERS = 1;
    private static final int MAX_COVERS = 99;

    private final TenantRepository tenantRepository;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public TenantInfoResponse getCurrentTenantInfo() {
        UUID tenantId = TenantContext.getTenantId();
        TenantEntity tenant = tenantRepository.findById(tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Tenant not found"));
        return toResponse(tenant);
    }

    @Transactional
    public TenantInfoResponse updateCurrentTenantInfo(TenantInfoUpdateRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        TenantEntity tenant = tenantRepository.findById(tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Tenant not found"));

        tenant.setName(request.getName());
        tenant.setAddressLine1(normalize(request.getAddressLine1()));
        tenant.setAddressLine2(normalize(request.getAddressLine2()));
        tenant.setPhone(normalize(request.getPhone()));
        // Logo lives in its own column — keeping the base64 blob out of the settings
        // JSONB that gets read/merged on every update.
        tenant.setLogoDataUri(normalize(request.getLogoUrl()));

        // Merge remaining branding + loyalty + restaurant fields into the existing
        // settings JSONB (preserves any other keys). Null fields are left untouched,
        // so saving one tab never clears another's settings.
        try {
            Map<String, Object> settings = new HashMap<>();
            if (tenant.getSettings() != null && !tenant.getSettings().isBlank()) {
                settings = objectMapper.readValue(tenant.getSettings(), new TypeReference<>() {});
            }
            settings.put("receiptFooter", normalize(request.getReceiptFooter()));
            if (request.getLoyaltyEnabled() != null) {
                settings.put("loyaltyEnabled", request.getLoyaltyEnabled());
            }
            if (request.getLoyaltySpendPerPoint() != null) {
                settings.put("loyaltySpendPerPoint", request.getLoyaltySpendPerPoint().toPlainString());
            }
            if (request.getLoyaltyPointValue() != null) {
                settings.put("loyaltyPointValue", request.getLoyaltyPointValue().toPlainString());
            }
            if (request.getTaxInclusive() != null) {
                settings.put("taxInclusive", request.getTaxInclusive());
            }
            if (request.getRestaurantMode() != null) {
                settings.put("restaurantMode", request.getRestaurantMode());
            }
            if (request.getDefaultCovers() != null) {
                settings.put("defaultCovers", request.getDefaultCovers());
            }
            tenant.setSettings(objectMapper.writeValueAsString(settings));
        } catch (Exception e) {
            log.warn("Failed to update tenant settings JSON: {}", e.getMessage());
        }

        return toResponse(tenantRepository.save(tenant));
    }

    /**
     * Reads a tenant's loyalty configuration from its settings JSONB, falling back
     * to {@link LoyaltyConfig#defaults()} for any key that has never been set.
     */
    @Transactional(readOnly = true)
    public LoyaltyConfig getLoyaltyConfig(UUID tenantId) {
        // Fall back to defaults if the tenant row is missing — loyalty config should
        // never be the reason a sale fails to ring up.
        return tenantRepository.findById(tenantId)
                .map(this::loyaltyConfigFromSettings)
                .orElseGet(LoyaltyConfig::defaults);
    }

    private LoyaltyConfig loyaltyConfigFromSettings(TenantEntity t) {
        LoyaltyConfig config = LoyaltyConfig.defaults();
        if (t.getSettings() == null || t.getSettings().isBlank()) {
            return config;
        }
        try {
            Map<String, Object> settings = objectMapper.readValue(t.getSettings(), new TypeReference<>() {});
            if (settings.get("loyaltyEnabled") instanceof Boolean enabled) {
                config.setEnabled(enabled);
            }
            BigDecimal spend = parseDecimal(settings.get("loyaltySpendPerPoint"));
            if (spend != null && spend.signum() > 0) {
                config.setSpendPerPoint(spend);
            }
            BigDecimal value = parseDecimal(settings.get("loyaltyPointValue"));
            if (value != null && value.signum() >= 0) {
                config.setPointValue(value);
            }
        } catch (Exception e) {
            log.warn("Could not parse tenant loyalty settings JSON: {}", e.getMessage());
        }
        return config;
    }

    /**
     * Whether the tenant prices goods VAT-inclusive (tax extracted from the
     * shelf price) vs exclusive (tax added at the till). Defaults to inclusive —
     * the Sri Lankan retail convention where the marked price is what the
     * customer pays. Never blocks a sale: a missing tenant/setting falls back to
     * inclusive.
     */
    @Transactional(readOnly = true)
    public boolean isTaxInclusive(UUID tenantId) {
        return tenantRepository.findById(tenantId)
                .map(this::taxInclusiveFromSettings)
                .orElse(true);
    }

    private boolean taxInclusiveFromSettings(TenantEntity t) {
        if (t.getSettings() == null || t.getSettings().isBlank()) {
            return true;
        }
        try {
            Map<String, Object> settings = objectMapper.readValue(t.getSettings(), new TypeReference<>() {});
            if (settings.get("taxInclusive") instanceof Boolean inclusive) {
                return inclusive;
            }
        } catch (Exception e) {
            log.warn("Could not parse tenant taxInclusive setting: {}", e.getMessage());
        }
        return true;
    }

    /**
     * Whether this business runs as a restaurant. The second half of the two-level
     * gate — the RESTAURANT feature flag says the API exists, this says the tenant
     * wants it. Defaults to false so a retail install behaves exactly as before.
     */
    @Transactional(readOnly = true)
    public boolean isRestaurantMode(UUID tenantId) {
        return tenantRepository.findById(tenantId)
                .map(this::restaurantModeFromSettings)
                .orElse(false);
    }

    private boolean restaurantModeFromSettings(TenantEntity t) {
        Object raw = settingValue(t, "restaurantMode");
        return raw instanceof Boolean enabled && enabled;
    }

    private int defaultCoversFromSettings(TenantEntity t) {
        Object raw = settingValue(t, "defaultCovers");
        if (raw instanceof Number n) {
            int covers = n.intValue();
            if (covers >= MIN_COVERS && covers <= MAX_COVERS) {
                return covers;
            }
        }
        return DEFAULT_COVERS;
    }

    /** Reads one key out of the settings JSONB; null when absent or unparseable. */
    private Object settingValue(TenantEntity t, String key) {
        if (t.getSettings() == null || t.getSettings().isBlank()) {
            return null;
        }
        try {
            Map<String, Object> settings = objectMapper.readValue(t.getSettings(), new TypeReference<>() {});
            return settings.get(key);
        } catch (Exception e) {
            log.warn("Could not parse tenant setting '{}': {}", key, e.getMessage());
            return null;
        }
    }

    private BigDecimal parseDecimal(Object raw) {
        if (raw == null) return null;
        try {
            return new BigDecimal(raw.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String normalize(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private TenantInfoResponse toResponse(TenantEntity t) {
        String receiptFooter = null;
        if (t.getSettings() != null && !t.getSettings().isBlank()) {
            try {
                Map<String, Object> settings = objectMapper.readValue(t.getSettings(), new TypeReference<>() {});
                receiptFooter = (String) settings.get("receiptFooter");
            } catch (Exception e) {
                log.warn("Could not parse tenant settings JSON: {}", e.getMessage());
            }
        }
        LoyaltyConfig loyalty = loyaltyConfigFromSettings(t);
        return TenantInfoResponse.builder()
                .id(t.getId())
                .name(t.getName())
                .addressLine1(t.getAddressLine1())
                .addressLine2(t.getAddressLine2())
                .phone(t.getPhone())
                .logoUrl(t.getLogoDataUri())
                .receiptFooter(receiptFooter)
                .loyaltyEnabled(loyalty.isEnabled())
                .loyaltySpendPerPoint(loyalty.getSpendPerPoint())
                .loyaltyPointValue(loyalty.getPointValue())
                .taxInclusive(taxInclusiveFromSettings(t))
                .restaurantMode(restaurantModeFromSettings(t))
                .defaultCovers(defaultCoversFromSettings(t))
                .build();
    }
}
