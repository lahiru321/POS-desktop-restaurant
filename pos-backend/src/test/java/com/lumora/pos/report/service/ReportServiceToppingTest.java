package com.lumora.pos.report.service;

import com.lumora.pos.branch.service.BranchAccessGuard;
import com.lumora.pos.report.dto.ReportDtos.ToppingSalesReport;
import com.lumora.pos.sales.repository.SaleRepository;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("ReportService — add-on sales")
class ReportServiceToppingTest {

    @Mock private SaleRepository saleRepository;
    @Mock private BranchAccessGuard branchAccessGuard;

    @InjectMocks private ReportService reportService;

    private final UUID tenantId = UUID.randomUUID();
    private final LocalDateTime start = LocalDateTime.of(2026, 9, 1, 0, 0);
    private final LocalDateTime end = LocalDateTime.of(2026, 9, 30, 23, 59);

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(tenantId);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    @Test
    @DisplayName("Nets completed refunds off each add-on and sorts by what it actually earned")
    void shouldNetRefundsAndSort() {
        UUID cheese = UUID.randomUUID();
        UUID egg = UUID.randomUUID();
        when(branchAccessGuard.reportBranchFilter(null)).thenReturn(Optional.empty());
        when(saleRepository.aggregateToppingSales(tenantId, start, end)).thenReturn(List.of(
                new Object[]{egg, "Egg", new BigDecimal("4"), new BigDecimal("400.00")},
                new Object[]{cheese, "Extra cheese", new BigDecimal("10"), new BigDecimal("1500.00")}));
        when(saleRepository.aggregateToppingRefunds(tenantId, start, end)).thenReturn(List.<Object[]>of(
                new Object[]{cheese, new BigDecimal("2"), new BigDecimal("300.00")}));

        ToppingSalesReport report = reportService.getToppingSales(start, end, null);

        assertThat(report.getTotalRevenue()).isEqualByComparingTo("1900.00");
        assertThat(report.getTotalRefunded()).isEqualByComparingTo("300.00");
        assertThat(report.getNetRevenue()).isEqualByComparingTo("1600.00");
        assertThat(report.getTotalPortions()).isEqualByComparingTo("14");
        assertThat(report.getToppings()).extracting(l -> l.getName()).containsExactly("Extra cheese", "Egg");
        assertThat(report.getToppings().get(0).getNetRevenue()).isEqualByComparingTo("1200.00");
        assertThat(report.getToppings().get(1).getRefunded()).isEqualByComparingTo("0");
    }

    @Test
    @DisplayName("A branch-restricted manager sees only their branches")
    void shouldApplyBranchFilter() {
        Set<UUID> mine = Set.of(UUID.randomUUID());
        when(branchAccessGuard.reportBranchFilter(null)).thenReturn(Optional.of(mine));
        when(saleRepository.aggregateToppingSalesByBranch(tenantId, start, end, mine)).thenReturn(List.of());
        when(saleRepository.aggregateToppingRefundsByBranch(tenantId, start, end, mine)).thenReturn(List.of());

        ToppingSalesReport report = reportService.getToppingSales(start, end, null);

        assertThat(report.getToppings()).isEmpty();
        verify(saleRepository, never()).aggregateToppingSales(any(), any(), any());
        verify(saleRepository).aggregateToppingSalesByBranch(eq(tenantId), eq(start), eq(end), eq(mine));
    }
}
