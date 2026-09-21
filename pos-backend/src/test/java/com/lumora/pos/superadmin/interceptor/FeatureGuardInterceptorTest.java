package com.lumora.pos.superadmin.interceptor;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lumora.pos.superadmin.entity.TenantConfigurationEntity;
import com.lumora.pos.superadmin.repository.TenantConfigurationRepository;
import com.lumora.pos.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("FeatureGuardInterceptor Unit Tests")
class FeatureGuardInterceptorTest {

    @Mock
    private TenantConfigurationRepository tenantConfigurationRepository;

    @Mock
    private ObjectMapper objectMapper;

    @Mock
    private HttpServletRequest request;

    @Mock
    private HttpServletResponse response;

    @InjectMocks
    private FeatureGuardInterceptor interceptor;

    private UUID tenantId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    @Test
    @DisplayName("Should pass when no tenant context is set")
    void shouldPassWhenNoTenant() throws Exception {
        TenantContext.clear();

        boolean result = interceptor.preHandle(request, response, new Object());

        assertThat(result).isTrue();
    }

    @Test
    @DisplayName("Should pass for non-guarded routes")
    void shouldPassForNonGuardedRoutes() throws Exception {
        TenantContext.setTenantId(tenantId);
        when(request.getRequestURI()).thenReturn("/api/v1/sales");

        boolean result = interceptor.preHandle(request, response, new Object());

        assertThat(result).isTrue();
        verifyNoInteractions(tenantConfigurationRepository);
    }

    @Test
    @DisplayName("Should pass when tenant has required feature")
    void shouldPassWhenTenantHasFeature() throws Exception {
        TenantContext.setTenantId(tenantId);
        when(request.getRequestURI()).thenReturn("/api/v1/returns");

        TenantConfigurationEntity config = new TenantConfigurationEntity();
        config.setFeaturesEnabled(List.of("SALES", "RETURNS"));

        when(tenantConfigurationRepository.findByTenantId(tenantId)).thenReturn(Optional.of(config));

        boolean result = interceptor.preHandle(request, response, new Object());

        assertThat(result).isTrue();
    }

    @Test
    @DisplayName("Should fail when tenant lacks required feature")
    void shouldFailWhenTenantLacksFeature() throws Exception {
        TenantContext.setTenantId(tenantId);
        when(request.getRequestURI()).thenReturn("/api/v1/returns");

        TenantConfigurationEntity config = new TenantConfigurationEntity();
        config.setFeaturesEnabled(List.of("SALES")); // Lacks RETURNS

        when(tenantConfigurationRepository.findByTenantId(tenantId)).thenReturn(Optional.of(config));
        
        StringWriter stringWriter = new StringWriter();
        PrintWriter printWriter = new PrintWriter(stringWriter);
        when(response.getWriter()).thenReturn(printWriter);
        when(objectMapper.writeValueAsString(any())).thenReturn("{\"message\":\"Forbidden\"}");

        boolean result = interceptor.preHandle(request, response, new Object());

        assertThat(result).isFalse();
        verify(response).setStatus(HttpStatus.FORBIDDEN.value());
    }

    @Test
    @DisplayName("Should refuse /api/v1/restaurant when the tenant lacks RESTAURANT")
    void shouldFailWhenTenantLacksRestaurant() throws Exception {
        TenantContext.setTenantId(tenantId);
        when(request.getRequestURI()).thenReturn("/api/v1/restaurant/orders");

        TenantConfigurationEntity config = new TenantConfigurationEntity();
        config.setFeaturesEnabled(List.of("SALES", "RETURNS")); // Lacks RESTAURANT

        when(tenantConfigurationRepository.findByTenantId(tenantId)).thenReturn(Optional.of(config));

        StringWriter stringWriter = new StringWriter();
        PrintWriter printWriter = new PrintWriter(stringWriter);
        when(response.getWriter()).thenReturn(printWriter);
        when(objectMapper.writeValueAsString(any())).thenReturn("{\"message\":\"Forbidden\"}");

        boolean result = interceptor.preHandle(request, response, new Object());

        assertThat(result).isFalse();
        verify(response).setStatus(HttpStatus.FORBIDDEN.value());
    }

    @Test
    @DisplayName("Should allow /api/v1/restaurant when the tenant has RESTAURANT")
    void shouldPassWhenTenantHasRestaurant() throws Exception {
        TenantContext.setTenantId(tenantId);
        // One prefix covers tables, areas, toppings, orders and kitchen tickets.
        when(request.getRequestURI()).thenReturn("/api/v1/restaurant/tables");

        TenantConfigurationEntity config = new TenantConfigurationEntity();
        config.setFeaturesEnabled(List.of("SALES", "RESTAURANT"));

        when(tenantConfigurationRepository.findByTenantId(tenantId)).thenReturn(Optional.of(config));

        boolean result = interceptor.preHandle(request, response, new Object());

        assertThat(result).isTrue();
    }

    @Test
    @DisplayName("Should fail when tenant config is completely missing")
    void shouldFailWhenTenantConfigMissing() throws Exception {
        TenantContext.setTenantId(tenantId);
        when(request.getRequestURI()).thenReturn("/api/v1/returns");

        when(tenantConfigurationRepository.findByTenantId(tenantId)).thenReturn(Optional.empty());

        StringWriter stringWriter = new StringWriter();
        PrintWriter printWriter = new PrintWriter(stringWriter);
        when(response.getWriter()).thenReturn(printWriter);
        when(objectMapper.writeValueAsString(any())).thenReturn("{\"message\":\"Forbidden\"}");

        boolean result = interceptor.preHandle(request, response, new Object());

        assertThat(result).isFalse();
        verify(response).setStatus(HttpStatus.FORBIDDEN.value());
    }
}
