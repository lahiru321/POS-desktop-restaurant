package com.lumora.pos.report.service;

import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.report.dto.ReportDtos.OrderTypeLine;
import com.lumora.pos.report.dto.ReportDtos.RestaurantSummaryReport;
import com.lumora.pos.report.dto.ReportDtos.SalesReportRecord;
import com.lumora.pos.restaurant.entity.RestaurantAreaEntity;
import com.lumora.pos.restaurant.entity.RestaurantOrderEntity;
import com.lumora.pos.restaurant.entity.RestaurantTableEntity;
import com.lumora.pos.restaurant.entity.RestaurantVoidEntity;
import com.lumora.pos.restaurant.repository.RestaurantAreaRepository;
import com.lumora.pos.restaurant.repository.RestaurantOrderRepository;
import com.lumora.pos.restaurant.repository.RestaurantTableRepository;
import com.lumora.pos.restaurant.repository.RestaurantVoidRepository;
import com.lumora.pos.sales.entity.SaleEntity;
import com.lumora.pos.sales.repository.SaleRepository;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The owner's summary against a real database: the sale ↔ order join that tells
 * dine-in from takeaway from counter, and the void log. Mocks would not catch a
 * JPQL entity join that Hibernate refuses.
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class RestaurantSummaryIntegrationTest {

    @Autowired private ReportService reportService;
    @Autowired private SaleRepository saleRepository;
    @Autowired private RestaurantOrderRepository orderRepository;
    @Autowired private RestaurantVoidRepository voidRepository;
    @Autowired private RestaurantAreaRepository areaRepository;
    @Autowired private RestaurantTableRepository tableRepository;
    @Autowired private BranchRepository branchRepository;
    @Autowired private UserRepository userRepository;

    private UUID tenantId;
    private BranchEntity branch;
    private UserEntity cashier;
    private UserEntity manager;
    private RestaurantTableEntity t4;
    private int orderNumber = 1;

    private final LocalDateTime start = LocalDateTime.now().minusDays(1);
    private final LocalDateTime end = LocalDateTime.now().plusDays(1);

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);
        cashier = user("Nimal", "Perera");
        manager = user("Kamala", "Silva");
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                manager.getId(), null, List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));

        branch = BranchEntity.builder().name("Main").isDefault(true).isActive(true).build();
        branch.setTenantId(tenantId);
        branch = branchRepository.save(branch);

        RestaurantAreaEntity area = RestaurantAreaEntity.builder().name("Hall").build();
        area.setTenantId(tenantId);
        area = areaRepository.save(area);
        t4 = RestaurantTableEntity.builder().area(area).name("T4").build();
        t4.setTenantId(tenantId);
        t4 = tableRepository.save(t4);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    @Test
    void splitsBillsByOrderTypeAndListsEveryVoid() {
        SaleEntity dineA = sale("INV-1", "3000.00", "300.00", false);
        SaleEntity dineB = sale("INV-2", "1000.00", "0.00", true);
        SaleEntity takeaway = sale("INV-3", "1500.00", "0.00", false);
        sale("INV-4", "500.00", "0.00", false); // counter: no order points at it

        RestaurantOrderEntity tabA = order(RestaurantOrderEntity.OrderType.DINE_IN, t4, 4, dineA);
        order(RestaurantOrderEntity.OrderType.DINE_IN, t4, 2, dineB);
        order(RestaurantOrderEntity.OrderType.TAKEAWAY, null, 0, takeaway);

        voidRow(tabA, "Chicken Kottu", "2", "1", "2400.00", false, "customer changed mind", manager.getId());
        voidRow(tabA, "Lime Juice", "1", "0", "350.00", false, null, null);

        RestaurantSummaryReport report = reportService.getRestaurantSummary(start, end, null);

        assertThat(report.getBills()).isEqualTo(4);
        assertThat(report.getRevenue()).isEqualByComparingTo("6000.00");
        assertThat(report.getAverageBill()).isEqualByComparingTo("1500.00");

        Map<String, OrderTypeLine> byType = report.getOrderTypes().stream()
                .collect(Collectors.toMap(OrderTypeLine::getOrderType, l -> l));
        assertThat(report.getOrderTypes()).extracting(OrderTypeLine::getOrderType)
                .containsExactly("DINE_IN", "TAKEAWAY", "COUNTER");
        assertThat(byType.get("DINE_IN").getBills()).isEqualTo(2);
        assertThat(byType.get("DINE_IN").getRevenue()).isEqualByComparingTo("4000.00");
        assertThat(byType.get("DINE_IN").getSharePct()).isEqualByComparingTo("66.7");
        assertThat(byType.get("TAKEAWAY").getRevenue()).isEqualByComparingTo("1500.00");
        assertThat(byType.get("COUNTER").getBills()).isEqualTo(1);

        assertThat(report.getCovers()).isEqualTo(6);
        assertThat(report.getRevenuePerCover()).isEqualByComparingTo("666.67");
        assertThat(report.getServiceChargeCollected()).isEqualByComparingTo("300.00");
        assertThat(report.getServiceChargeWaivedBills()).isEqualTo(1);

        assertThat(report.getVoidCount()).isEqualTo(2);
        assertThat(report.getVoidedAmount()).isEqualByComparingTo("2750.00");
        // Half the kottu was already cooking: 1 of 2 at 1200 each.
        assertThat(report.getVoidedAfterKitchenAmount()).isEqualByComparingTo("1200.00");
        assertThat(report.getVoids()).anySatisfy(v -> {
            assertThat(v.getItemName()).isEqualTo("Chicken Kottu");
            assertThat(v.getOrderLabel()).isEqualTo("#" + tabA.getOrderNumber() + " · T4");
            assertThat(v.getVoidedBy()).isEqualTo("Nimal Perera");
            assertThat(v.getApprovedBy()).isEqualTo("Kamala Silva");
            assertThat(v.getReason()).isEqualTo("customer changed mind");
        });
    }

    @Test
    void salesHistoryShowsOrderTypeAndTable() {
        SaleEntity dine = sale("INV-10", "2000.00", "200.00", false);
        sale("INV-11", "400.00", "0.00", false);
        order(RestaurantOrderEntity.OrderType.DINE_IN, t4, 2, dine);

        List<SalesReportRecord> rows = reportService
                .getSalesReport(start, end, null, PageRequest.of(0, 10)).getContent();

        Map<String, SalesReportRecord> byInvoice = rows.stream()
                .collect(Collectors.toMap(SalesReportRecord::getInvoiceNumber, r -> r));
        assertThat(byInvoice.get("INV-10").getOrderType()).isEqualTo("DINE_IN");
        assertThat(byInvoice.get("INV-10").getTableName()).isEqualTo("T4");
        assertThat(byInvoice.get("INV-10").getServiceChargeAmount()).isEqualByComparingTo("200.00");
        assertThat(byInvoice.get("INV-11").getOrderType()).isEqualTo("COUNTER");
        assertThat(byInvoice.get("INV-11").getTableName()).isNull();
    }

    private UserEntity user(String first, String last) {
        UserEntity u = UserEntity.builder()
                .email(first.toLowerCase() + "-" + UUID.randomUUID() + "@test.local")
                .passwordHash("x").firstName(first).lastName(last).isActive(true).build();
        u.setTenantId(tenantId);
        return userRepository.save(u);
    }

    private SaleEntity sale(String invoice, String net, String serviceCharge, boolean waived) {
        SaleEntity s = new SaleEntity();
        s.setTenantId(tenantId);
        s.setInvoiceNumber(invoice + "-" + UUID.randomUUID().toString().substring(0, 6));
        s.setTotalAmount(new BigDecimal(net));
        s.setTaxAmount(BigDecimal.ZERO);
        s.setDiscountAmount(BigDecimal.ZERO);
        s.setNetAmount(new BigDecimal(net));
        s.setServiceChargeAmount(new BigDecimal(serviceCharge));
        s.setServiceChargeWaived(waived);
        s.setPaymentStatus(SaleEntity.PaymentStatus.PAID);
        s.setPaymentMethod(SaleEntity.PaymentMethod.CASH);
        s.setBranch(branch);
        SaleEntity saved = saleRepository.saveAndFlush(s);
        saved.setInvoiceNumber(invoice);
        return saleRepository.saveAndFlush(saved);
    }

    private RestaurantOrderEntity order(RestaurantOrderEntity.OrderType type, RestaurantTableEntity table,
            int covers, SaleEntity sale) {
        RestaurantOrderEntity o = RestaurantOrderEntity.builder()
                .branch(branch)
                .orderNumber(orderNumber++)
                .businessDate(LocalDate.now())
                .orderType(type)
                .table(table)
                .covers(covers)
                .status(RestaurantOrderEntity.OrderStatus.SETTLED)
                .saleId(sale.getId())
                .openedAt(LocalDateTime.now())
                .settledAt(LocalDateTime.now())
                .build();
        o.setTenantId(tenantId);
        return orderRepository.saveAndFlush(o);
    }

    private void voidRow(RestaurantOrderEntity order, String item, String qty, String fired, String amount,
            boolean wholeTab, String reason, UUID approvedBy) {
        RestaurantVoidEntity v = RestaurantVoidEntity.builder()
                .branchId(branch.getId())
                .orderId(order.getId())
                .orderItemId(UUID.randomUUID())
                .itemName(item)
                .quantity(new BigDecimal(qty))
                .firedQuantity(new BigDecimal(fired))
                .amount(new BigDecimal(amount))
                .wholeTab(wholeTab)
                .reason(reason)
                .voidedBy(cashier.getId())
                .approvedBy(approvedBy)
                .voidedAt(LocalDateTime.now())
                .build();
        v.setTenantId(tenantId);
        voidRepository.saveAndFlush(v);
    }
}
