package com.lumora.pos.tenant.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.lumora.pos.superadmin.entity.TenantEntity;
import com.lumora.pos.superadmin.repository.TenantRepository;
import com.lumora.pos.tenant.TenantContext;
import com.lumora.pos.tenant.dto.TenantInfoDtos.TenantInfoResponse;
import com.lumora.pos.tenant.dto.TenantInfoDtos.TenantInfoUpdateRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Covers the `tenants.settings` JSONB round-trip for the restaurant settings —
 * specifically that they default off, survive a save, and never clobber the
 * sibling loyalty keys stored in the same blob.
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("TenantInfoService Unit Tests")
class TenantInfoServiceTest {

    @Mock private TenantRepository tenantRepository;
    @Spy private ObjectMapper objectMapper = new ObjectMapper();

    @InjectMocks private TenantInfoService service;

    private static final UUID TENANT_ID = UUID.randomUUID();

    private TenantEntity tenant;

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT_ID);
        tenant = TenantEntity.builder()
                .id(TENANT_ID)
                .name("Spice Garden")
                .addressLine1("12 Galle Road")
                .phone("0112345678")
                .build();
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    private void stubRepository() {
        when(tenantRepository.findById(TENANT_ID)).thenReturn(Optional.of(tenant));
        when(tenantRepository.save(any(TenantEntity.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private TenantInfoUpdateRequest baseRequest() {
        TenantInfoUpdateRequest request = new TenantInfoUpdateRequest();
        request.setName(tenant.getName());
        request.setAddressLine1(tenant.getAddressLine1());
        request.setPhone(tenant.getPhone());
        return request;
    }

    private Map<String, Object> settingsMap() throws Exception {
        return objectMapper.readValue(tenant.getSettings(), new TypeReference<>() {});
    }

    @Nested
    @DisplayName("Defaults")
    class Defaults {

        @Test
        @DisplayName("restaurant mode is off and covers default when settings are empty")
        void defaultsWhenAbsent() {
            when(tenantRepository.findById(TENANT_ID)).thenReturn(Optional.of(tenant));

            TenantInfoResponse response = service.getCurrentTenantInfo();

            assertThat(response.isRestaurantMode()).isFalse();
            assertThat(response.getDefaultCovers()).isEqualTo(2);
            assertThat(service.isRestaurantMode(TENANT_ID)).isFalse();
        }

        @Test
        @DisplayName("restaurant mode is off when the blob holds only loyalty keys")
        void defaultsWhenOtherKeysPresent() {
            tenant.setSettings("{\"loyaltyEnabled\":true,\"loyaltySpendPerPoint\":\"25\"}");
            when(tenantRepository.findById(TENANT_ID)).thenReturn(Optional.of(tenant));

            TenantInfoResponse response = service.getCurrentTenantInfo();

            assertThat(response.isRestaurantMode()).isFalse();
            assertThat(response.getDefaultCovers()).isEqualTo(2);
        }

        @Test
        @DisplayName("an out-of-range stored covers value falls back to the default")
        void ignoresOutOfRangeCovers() {
            tenant.setSettings("{\"defaultCovers\":0}");
            when(tenantRepository.findById(TENANT_ID)).thenReturn(Optional.of(tenant));

            assertThat(service.getCurrentTenantInfo().getDefaultCovers()).isEqualTo(2);
        }
    }

    @Nested
    @DisplayName("Round-trip")
    class RoundTrip {

        @Test
        @DisplayName("saving restaurant settings persists them and reads them back")
        void roundTrip() {
            stubRepository();
            TenantInfoUpdateRequest request = baseRequest();
            request.setRestaurantMode(true);
            request.setDefaultCovers(4);

            TenantInfoResponse saved = service.updateCurrentTenantInfo(request);

            assertThat(saved.isRestaurantMode()).isTrue();
            assertThat(saved.getDefaultCovers()).isEqualTo(4);
            assertThat(service.getCurrentTenantInfo().isRestaurantMode()).isTrue();
            assertThat(service.isRestaurantMode(TENANT_ID)).isTrue();
        }

        @Test
        @DisplayName("omitting the restaurant fields leaves them unchanged")
        void omittingLeavesUnchanged() {
            tenant.setSettings("{\"restaurantMode\":true,\"defaultCovers\":6}");
            stubRepository();

            TenantInfoResponse saved = service.updateCurrentTenantInfo(baseRequest());

            assertThat(saved.isRestaurantMode()).isTrue();
            assertThat(saved.getDefaultCovers()).isEqualTo(6);
        }

        @Test
        @DisplayName("restaurant mode can be turned back off")
        void canBeDisabled() {
            tenant.setSettings("{\"restaurantMode\":true}");
            stubRepository();
            TenantInfoUpdateRequest request = baseRequest();
            request.setRestaurantMode(false);

            assertThat(service.updateCurrentTenantInfo(request).isRestaurantMode()).isFalse();
        }
    }

    @Nested
    @DisplayName("Settings blob co-existence")
    class Coexistence {

        @Test
        @DisplayName("saving restaurant settings does not wipe loyalty settings")
        void keepsLoyaltySettings() throws Exception {
            tenant.setSettings(
                    "{\"loyaltyEnabled\":true,\"loyaltySpendPerPoint\":\"25\",\"loyaltyPointValue\":\"0.50\","
                            + "\"taxInclusive\":false,\"receiptFooter\":\"Thank you\"}");
            stubRepository();
            TenantInfoUpdateRequest request = baseRequest();
            request.setReceiptFooter("Thank you");
            request.setRestaurantMode(true);
            request.setDefaultCovers(4);

            TenantInfoResponse saved = service.updateCurrentTenantInfo(request);

            assertThat(saved.isLoyaltyEnabled()).isTrue();
            assertThat(saved.getLoyaltySpendPerPoint()).isEqualByComparingTo(new BigDecimal("25"));
            assertThat(saved.getLoyaltyPointValue()).isEqualByComparingTo(new BigDecimal("0.50"));
            assertThat(saved.isTaxInclusive()).isFalse();
            assertThat(saved.isRestaurantMode()).isTrue();
            assertThat(settingsMap()).containsKeys(
                    "loyaltyEnabled", "loyaltySpendPerPoint", "loyaltyPointValue", "restaurantMode", "defaultCovers");
        }

        @Test
        @DisplayName("saving loyalty settings does not wipe restaurant settings")
        void keepsRestaurantSettings() {
            tenant.setSettings("{\"restaurantMode\":true,\"defaultCovers\":4}");
            stubRepository();
            TenantInfoUpdateRequest request = baseRequest();
            request.setLoyaltyEnabled(true);
            request.setLoyaltySpendPerPoint(new BigDecimal("25"));
            request.setLoyaltyPointValue(new BigDecimal("0.50"));

            TenantInfoResponse saved = service.updateCurrentTenantInfo(request);

            assertThat(saved.isRestaurantMode()).isTrue();
            assertThat(saved.getDefaultCovers()).isEqualTo(4);
            assertThat(saved.isLoyaltyEnabled()).isTrue();
            assertThat(saved.getLoyaltySpendPerPoint()).isEqualByComparingTo(new BigDecimal("25"));
        }
    }
}
