package com.lumora.pos.restaurant.service;

import com.lumora.pos.inventory.repository.CategoryRepository;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.inventory.service.KitchenStations;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@DisplayName("KitchenStationService Unit Tests")
class KitchenStationServiceTest {

    @Mock private ProductRepository productRepository;
    @Mock private CategoryRepository categoryRepository;

    @InjectMocks private KitchenStationService stationService;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    @Test
    @DisplayName("KITCHEN always comes first, then every named station once, alphabetically")
    void shouldListKitchenFirstThenDistinctStations() {
        when(productRepository.findDistinctKitchenStations(tenantId)).thenReturn(List.of("GRILL", "bar", "KITCHEN"));
        when(categoryRepository.findDistinctKitchenStations(tenantId)).thenReturn(List.of("BAR", " "));

        assertThat(stationService.listStations()).containsExactly("KITCHEN", "BAR", "GRILL");
    }

    @Test
    @DisplayName("With nothing routed anywhere, the only station is KITCHEN")
    void shouldListKitchenAlone() {
        when(productRepository.findDistinctKitchenStations(tenantId)).thenReturn(List.of());
        when(categoryRepository.findDistinctKitchenStations(tenantId)).thenReturn(List.of());

        assertThat(stationService.listStations()).containsExactly("KITCHEN");
    }

    @Test
    @DisplayName("normalize trims, collapses spaces, upper-cases, and turns blank into inherit")
    void shouldNormalize() {
        assertThat(KitchenStations.normalize("  cold   bar ")).isEqualTo("COLD BAR");
        assertThat(KitchenStations.normalize("   ")).isNull();
        assertThat(KitchenStations.normalize(null)).isNull();
    }
}
