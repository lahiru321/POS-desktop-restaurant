package com.lumora.pos.restaurant.service;

import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.branch.entity.BranchEntity;
import com.lumora.pos.branch.repository.BranchRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.restaurant.dto.OrderDtos;
import com.lumora.pos.restaurant.entity.*;
import com.lumora.pos.restaurant.repository.RestaurantOrderCounterDao;
import com.lumora.pos.restaurant.repository.RestaurantOrderRepository;
import com.lumora.pos.restaurant.repository.RestaurantTableRepository;
import com.lumora.pos.restaurant.repository.ToppingRepository;
import com.lumora.pos.sales.dto.SaleRequest;
import com.lumora.pos.sales.dto.SaleResponse;
import com.lumora.pos.sales.service.SaleService;
import com.lumora.pos.tenant.TenantContext;
import com.lumora.pos.auth.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@DisplayName("RestaurantOrderService Unit Tests")
class RestaurantOrderServiceTest {

    @Mock private RestaurantOrderRepository orderRepository;
    @Mock private RestaurantTableRepository tableRepository;
    @Mock private RestaurantOrderCounterDao counterDao;
    @Mock private ProductRepository productRepository;
    @Mock private ToppingRepository toppingRepository;
    @Mock private BranchRepository branchRepository;
    @Mock private UserRepository userRepository;
    @Mock private SaleService saleService;
    @Mock private AuditService auditService;

    @InjectMocks private RestaurantOrderService orderService;

    private UUID tenantId;
    private BranchEntity branch;
    private RestaurantTableEntity table;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);

        branch = new BranchEntity();
        branch.setId(UUID.randomUUID());
        branch.setTenantId(tenantId);

        RestaurantAreaEntity area = RestaurantAreaEntity.builder().name("Balcony").build();
        area.setId(UUID.randomUUID());
        area.setTenantId(tenantId);

        table = RestaurantTableEntity.builder().area(area).name("T1").seats(4).build();
        table.setId(UUID.randomUUID());
        table.setTenantId(tenantId);
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    // ==================================================================
    @Nested
    @DisplayName("Opening a tab")
    class Opening {

        @Test
        @DisplayName("Seats the table, takes its number from the counter, marks it OCCUPIED")
        void shouldSeatTable() {
            when(branchRepository.findByIsDefaultTrueAndTenantId(tenantId)).thenReturn(Optional.of(branch));
            when(tableRepository.findByIdAndTenantId(table.getId(), tenantId)).thenReturn(Optional.of(table));
            when(orderRepository.findOpenByTableId(tenantId, table.getId())).thenReturn(Optional.empty());
            when(counterDao.nextOrderNumber(eq(tenantId), eq(branch.getId()), any(LocalDate.class)))
                    .thenReturn(14);
            when(orderRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.OrderResponse response = orderService.open(OrderDtos.OpenOrderRequest.builder()
                    .orderType(RestaurantOrderEntity.OrderType.DINE_IN)
                    .tableId(table.getId())
                    .covers(2)
                    .build());

            assertThat(response.getOrderNumber()).isEqualTo(14);
            assertThat(response.getLabel()).isEqualTo("Order 14 · T1");
            assertThat(response.getStatus()).isEqualTo(RestaurantOrderEntity.OrderStatus.OPEN);
            assertThat(table.getStatus()).isEqualTo(RestaurantTableEntity.TableStatus.OCCUPIED);
        }

        @Test
        @DisplayName("Dine-in without a table is refused")
        void shouldRequireTableForDineIn() {
            when(branchRepository.findByIsDefaultTrueAndTenantId(tenantId)).thenReturn(Optional.of(branch));

            assertThatThrownBy(() -> orderService.open(OrderDtos.OpenOrderRequest.builder()
                    .orderType(RestaurantOrderEntity.OrderType.DINE_IN)
                    .build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("Pick a table");
        }

        @Test
        @DisplayName("Takeaway with a table is refused")
        void shouldRejectTableForTakeaway() {
            when(branchRepository.findByIsDefaultTrueAndTenantId(tenantId)).thenReturn(Optional.of(branch));

            assertThatThrownBy(() -> orderService.open(OrderDtos.OpenOrderRequest.builder()
                    .orderType(RestaurantOrderEntity.OrderType.TAKEAWAY)
                    .tableId(table.getId())
                    .build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("no table");
        }

        @Test
        @DisplayName("A table that already has an open tab is refused by name and number")
        void shouldRefuseSecondTabOnTable() {
            RestaurantOrderEntity existing = order();
            existing.setOrderNumber(9);

            when(branchRepository.findByIsDefaultTrueAndTenantId(tenantId)).thenReturn(Optional.of(branch));
            when(tableRepository.findByIdAndTenantId(table.getId(), tenantId)).thenReturn(Optional.of(table));
            when(orderRepository.findOpenByTableId(tenantId, table.getId())).thenReturn(Optional.of(existing));

            assertThatThrownBy(() -> orderService.open(OrderDtos.OpenOrderRequest.builder()
                    .tableId(table.getId())
                    .build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("T1")
                    .hasMessageContaining("order 9");

            verify(counterDao, never()).nextOrderNumber(any(), any(), any());
        }

        @Test
        @DisplayName("Losing the uk_rest_order_open_table race reads as a busy table, not a 500")
        void shouldTranslateOpenTableConstraintViolation() {
            when(branchRepository.findByIsDefaultTrueAndTenantId(tenantId)).thenReturn(Optional.of(branch));
            when(tableRepository.findByIdAndTenantId(table.getId(), tenantId)).thenReturn(Optional.of(table));
            // The read-check passes — the other server's INSERT lands in between.
            when(orderRepository.findOpenByTableId(tenantId, table.getId())).thenReturn(Optional.empty());
            when(counterDao.nextOrderNumber(any(), any(), any())).thenReturn(1);
            when(orderRepository.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException(
                    "could not execute statement",
                    new RuntimeException("ERROR: duplicate key value violates unique constraint "
                            + "\"uk_rest_order_open_table\"")));

            assertThatThrownBy(() -> orderService.open(OrderDtos.OpenOrderRequest.builder()
                    .tableId(table.getId())
                    .build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessage("Table T1 already has an open tab");
        }

        @Test
        @DisplayName("An unrelated integrity violation is not disguised as a busy table")
        void shouldNotSwallowUnrelatedIntegrityViolation() {
            when(branchRepository.findByIsDefaultTrueAndTenantId(tenantId)).thenReturn(Optional.of(branch));
            when(tableRepository.findByIdAndTenantId(table.getId(), tenantId)).thenReturn(Optional.of(table));
            when(orderRepository.findOpenByTableId(tenantId, table.getId())).thenReturn(Optional.empty());
            when(counterDao.nextOrderNumber(any(), any(), any())).thenReturn(1);
            when(orderRepository.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException(
                    "ERROR: null value in column \"item_name\" violates not-null constraint"));

            assertThatThrownBy(() -> orderService.open(OrderDtos.OpenOrderRequest.builder()
                    .tableId(table.getId())
                    .build()))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }
    }

    // ==================================================================
    @Nested
    @DisplayName("Pricing a line at ring-up")
    class Pricing {

        @Test
        @DisplayName("A catalogue line snapshots the product's price, ignoring the client's")
        void shouldSnapshotCataloguePrice() {
            ProductEntity product = new ProductEntity();
            product.setId(UUID.randomUUID());
            product.setName("Kottu");
            product.setBasePrice(new BigDecimal("950.00"));

            when(branchRepository.findByIsDefaultTrueAndTenantId(tenantId)).thenReturn(Optional.of(branch));
            when(tableRepository.findByIdAndTenantId(table.getId(), tenantId)).thenReturn(Optional.of(table));
            when(orderRepository.findOpenByTableId(tenantId, table.getId())).thenReturn(Optional.empty());
            when(counterDao.nextOrderNumber(any(), any(), any())).thenReturn(1);
            when(productRepository.findByIdAndTenantId(product.getId(), tenantId)).thenReturn(Optional.of(product));
            when(orderRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.OrderResponse response = orderService.open(OrderDtos.OpenOrderRequest.builder()
                    .tableId(table.getId())
                    .items(List.of(OrderDtos.OrderItemRequest.builder()
                            .productId(product.getId())
                            .quantity(BigDecimal.ONE)
                            // A client trying to set its own price for a catalogue dish.
                            .unitPrice(new BigDecimal("1.00"))
                            .build()))
                    .build());

            assertThat(response.getItems()).hasSize(1);
            assertThat(response.getItems().get(0).getUnitPriceSnapshot())
                    .isEqualByComparingTo("950.00");
            assertThat(response.getItems().get(0).getItemName()).isEqualTo("Kottu");
        }

        @Test
        @DisplayName("A FIXED topping bills its configured price; a PROMPT one under the ceiling stands")
        void shouldApplyToppingPriceMode() {
            ToppingEntity fixed = fixedTopping("Cheese", "150.00");
            ToppingEntity prompt = promptTopping("Extra portion", "500.00");

            stubOpenOnTable();
            when(toppingRepository.findByIdAndTenantId(fixed.getId(), tenantId)).thenReturn(Optional.of(fixed));
            when(toppingRepository.findByIdAndTenantId(prompt.getId(), tenantId)).thenReturn(Optional.of(prompt));
            when(orderRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.OrderResponse response = orderService.open(OrderDtos.OpenOrderRequest.builder()
                    .tableId(table.getId())
                    .items(List.of(OrderDtos.OrderItemRequest.builder()
                            .itemName("Chef's special")
                            .quantity(BigDecimal.ONE)
                            .unitPrice(new BigDecimal("1200.00"))
                            .toppings(List.of(
                                    OrderDtos.OrderItemToppingRequest.builder()
                                            .toppingId(fixed.getId())
                                            // Ignored: the topping is FIXED.
                                            .unitPrice(new BigDecimal("1.00"))
                                            .build(),
                                    OrderDtos.OrderItemToppingRequest.builder()
                                            .toppingId(prompt.getId())
                                            // Inside the ceiling: the typed figure stands.
                                            .unitPrice(new BigDecimal("450.00"))
                                            .build()))
                            .build()))
                    .build());

            List<OrderDtos.OrderItemToppingResponse> toppings = response.getItems().get(0).getToppings();
            assertThat(toppings).hasSize(2);
            assertThat(toppings.get(0).getUnitPrice()).isEqualByComparingTo("150.00");
            assertThat(toppings.get(1).getUnitPrice()).isEqualByComparingTo("450.00");
            // A custom line has no catalogue entry, so its typed price stands.
            assertThat(response.getItems().get(0).getUnitPriceSnapshot()).isEqualByComparingTo("1200.00");
        }

        @Test
        @DisplayName("A PROMPT price over the ceiling is refused, not quietly rewritten")
        void shouldRefusePromptPriceOverMax() {
            ToppingEntity prompt = promptTopping("Extra portion", "500.00");

            stubOpenOnTable();
            when(toppingRepository.findByIdAndTenantId(prompt.getId(), tenantId)).thenReturn(Optional.of(prompt));

            assertThatThrownBy(() -> orderService.open(lineWithTopping(
                    OrderDtos.OrderItemToppingRequest.builder()
                            .toppingId(prompt.getId())
                            .unitPrice(new BigDecimal("9999.00"))
                            .build())))
                    .isInstanceOf(BusinessException.class)
                    // Word for word what SaleService says for the same input.
                    .hasMessage("Price for Extra portion exceeds the allowed maximum of 500.00");

            verify(orderRepository, never()).saveAndFlush(any());
        }

        @Test
        @DisplayName("A PROMPT topping with no price typed is refused, not billed free")
        void shouldRefusePromptWithoutPrice() {
            ToppingEntity prompt = promptTopping("Extra portion", "500.00");

            stubOpenOnTable();
            when(toppingRepository.findByIdAndTenantId(prompt.getId(), tenantId)).thenReturn(Optional.of(prompt));

            assertThatThrownBy(() -> orderService.open(lineWithTopping(
                    OrderDtos.OrderItemToppingRequest.builder()
                            .toppingId(prompt.getId())
                            .build())))
                    .isInstanceOf(BusinessException.class)
                    .hasMessage("A price is required for Extra portion");

            verify(orderRepository, never()).saveAndFlush(any());
        }

        @Test
        @DisplayName("An inactive topping is refused at ring-up, not left to blow up the settle")
        void shouldRefuseInactiveTopping() {
            ToppingEntity retired = fixedTopping("Truffle shavings", "900.00");
            retired.setActive(false);

            stubOpenOnTable();
            when(toppingRepository.findByIdAndTenantId(retired.getId(), tenantId)).thenReturn(Optional.of(retired));

            assertThatThrownBy(() -> orderService.open(lineWithTopping(
                    OrderDtos.OrderItemToppingRequest.builder()
                            .toppingId(retired.getId())
                            .build())))
                    .isInstanceOf(BusinessException.class)
                    .hasMessage("Topping Truffle shavings is no longer available");

            verify(orderRepository, never()).saveAndFlush(any());
        }

        /** Stubs for "a fresh dine-in tab on a free table", up to the first line. */
        private void stubOpenOnTable() {
            when(branchRepository.findByIsDefaultTrueAndTenantId(tenantId)).thenReturn(Optional.of(branch));
            when(tableRepository.findByIdAndTenantId(table.getId(), tenantId)).thenReturn(Optional.of(table));
            when(orderRepository.findOpenByTableId(tenantId, table.getId())).thenReturn(Optional.empty());
            when(counterDao.nextOrderNumber(any(), any(), any())).thenReturn(1);
        }

        private OrderDtos.OpenOrderRequest lineWithTopping(OrderDtos.OrderItemToppingRequest topping) {
            return OrderDtos.OpenOrderRequest.builder()
                    .tableId(table.getId())
                    .items(List.of(OrderDtos.OrderItemRequest.builder()
                            .itemName("Chef's special")
                            .quantity(BigDecimal.ONE)
                            .unitPrice(new BigDecimal("1200.00"))
                            .toppings(List.of(topping))
                            .build()))
                    .build();
        }
    }

    // ==================================================================
    @Nested
    @DisplayName("Voiding and editing lines")
    class Voiding {

        @Test
        @DisplayName("A partial void leaves the rest billable")
        void shouldVoidPartially() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity item = item(order, "Kottu", "3", "950.00");

            when(orderRepository.findByIdAndTenantId(order.getId(), tenantId)).thenReturn(Optional.of(order));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.OrderResponse response = orderService.voidItem(order.getId(), item.getId(),
                    OrderDtos.VoidItemRequest.builder().quantity(new BigDecimal("1")).reason("dropped").build());

            assertThat(response.getItems().get(0).getVoidedQuantity()).isEqualByComparingTo("1");
            assertThat(response.getItems().get(0).getBillableQuantity()).isEqualByComparingTo("2");
        }

        @Test
        @DisplayName("Voiding more than is left is refused")
        void shouldRefuseOverVoid() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity item = item(order, "Kottu", "2", "950.00");

            when(orderRepository.findByIdAndTenantId(order.getId(), tenantId)).thenReturn(Optional.of(order));

            assertThatThrownBy(() -> orderService.voidItem(order.getId(), item.getId(),
                    OrderDtos.VoidItemRequest.builder().quantity(new BigDecimal("5")).build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("only 2 left");
        }

        @Test
        @DisplayName("Reducing below what the kitchen already has is refused — that is a void")
        void shouldRefuseShrinkingBelowFired() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity item = item(order, "Kottu", "3", "950.00");
            item.setFiredQuantity(new BigDecimal("2"));

            when(orderRepository.findByIdAndTenantId(order.getId(), tenantId)).thenReturn(Optional.of(order));

            assertThatThrownBy(() -> orderService.updateItem(order.getId(), item.getId(),
                    OrderDtos.UpdateItemRequest.builder().quantity(BigDecimal.ONE).build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("Void it instead");
        }
    }

    // ==================================================================
    @Nested
    @DisplayName("Settling")
    class Settling {

        @Test
        @DisplayName("Bills ordered-less-voided through createSale, on the order's branch")
        void shouldBillBillableQuantities() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity kottu = item(order, "Kottu", "3", "950.00");
            kottu.setVoidedQuantity(BigDecimal.ONE);
            RestaurantOrderItemEntity gone = item(order, "Soup", "1", "400.00");
            gone.setVoidedQuantity(BigDecimal.ONE);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(saleService.createSale(any())).thenReturn(sale(new BigDecimal("950.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            orderService.settle(order.getId(), OrderDtos.SettleRequest.builder()
                    .paymentMethod("CASH").build());

            ArgumentCaptor<SaleRequest> captor = ArgumentCaptor.forClass(SaleRequest.class);
            verify(saleService).createSale(captor.capture());
            SaleRequest sent = captor.getValue();

            // The fully-voided line is gone; the partly-voided one bills what is left.
            assertThat(sent.getItems()).hasSize(1);
            assertThat(sent.getItems().get(0).getQuantity()).isEqualByComparingTo("2");
            assertThat(sent.getBranchId()).isEqualTo(branch.getId());
            assertThat(sent.getPaymentMethod()).isEqualTo("CASH");
        }

        @Test
        @DisplayName("Settling marks the order SETTLED and frees the table")
        void shouldFreeTable() {
            RestaurantOrderEntity order = order();
            item(order, "Kottu", "1", "950.00");
            table.setStatus(RestaurantTableEntity.TableStatus.OCCUPIED);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            SaleResponse sale = sale(new BigDecimal("950.00"));
            when(saleService.createSale(any())).thenReturn(sale);
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.SettleResponse response = orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            assertThat(order.getStatus()).isEqualTo(RestaurantOrderEntity.OrderStatus.SETTLED);
            assertThat(order.getSaleId()).isEqualTo(sale.getId());
            assertThat(order.getSettledAt()).isNotNull();
            assertThat(table.getStatus()).isEqualTo(RestaurantTableEntity.TableStatus.AVAILABLE);
            assertThat(response.getLabel()).isEqualTo("Order 14 · T1");
        }

        @Test
        @DisplayName("A tab with nothing left to bill is refused, not sent as an empty sale")
        void shouldRefuseEmptySettle() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity item = item(order, "Kottu", "1", "950.00");
            item.setVoidedQuantity(BigDecimal.ONE);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));

            assertThatThrownBy(() -> orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("void the order instead");

            verify(saleService, never()).createSale(any());
        }

        @Test
        @DisplayName("Settling twice is refused")
        void shouldRefuseDoubleSettle() {
            RestaurantOrderEntity order = order();
            order.setStatus(RestaurantOrderEntity.OrderStatus.SETTLED);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));

            assertThatThrownBy(() -> orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("already SETTLED");

            verify(saleService, never()).createSale(any());
        }

        @Test
        @DisplayName("A menu price that moved mid-meal is reported, not hidden")
        void shouldReportRepricedLines() {
            RestaurantOrderEntity order = order();
            item(order, "Kottu", "1", "950.00");

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            // createSale re-read the catalogue and billed the new price.
            when(saleService.createSale(any())).thenReturn(sale(new BigDecimal("1050.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.SettleResponse response = orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            assertThat(response.getRepricedLines()).hasSize(1);
            assertThat(response.getRepricedLines().get(0).getOrderedPrice()).isEqualByComparingTo("950.00");
            assertThat(response.getRepricedLines().get(0).getBilledPrice()).isEqualByComparingTo("1050.00");
        }

        @Test
        @DisplayName("A FIXED add-on whose price moved is reported too, naming its dish")
        void shouldReportRepricedFixedTopping() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity kottu = item(order, "Kottu", "1", "950.00");
            RestaurantOrderItemToppingEntity cheese =
                    topping(kottu, "Cheese", "150.00", ToppingEntity.PriceMode.FIXED);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            // The dish held; createSale re-read toppings.default_price and billed 200.
            when(saleService.createSale(any())).thenReturn(saleWithTopping(
                    new BigDecimal("950.00"), cheese.getToppingId(), new BigDecimal("200.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.SettleResponse response = orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            assertThat(response.getRepricedLines()).hasSize(1);
            OrderDtos.RepricedLine line = response.getRepricedLines().get(0);
            assertThat(line.getItemName()).isEqualTo("Kottu");
            assertThat(line.getToppingName()).isEqualTo("Cheese");
            assertThat(line.getOrderedPrice()).isEqualByComparingTo("150.00");
            assertThat(line.getBilledPrice()).isEqualByComparingTo("200.00");
        }

        @Test
        @DisplayName("A PROMPT add-on is cashier-authored, so it never counts as re-priced")
        void shouldNotRepricePromptTopping() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity dish = item(order, "Chef's special", "1", "1200.00");
            RestaurantOrderItemToppingEntity extra =
                    topping(dish, "Extra portion", "450.00", ToppingEntity.PriceMode.PROMPT);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(saleService.createSale(any())).thenReturn(saleWithTopping(
                    new BigDecimal("1200.00"), extra.getToppingId(), new BigDecimal("999.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.SettleResponse response = orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            assertThat(response.getRepricedLines()).isEmpty();
        }

        @Test
        @DisplayName("A partly-voided discounted line bills the discount pro-rated, not in full")
        void shouldProRateDiscountAcrossAVoid() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity kottu = item(order, "Kottu", "3", "950.00");
            kottu.setDiscountAmount(new BigDecimal("300.00"));
            kottu.setVoidedQuantity(BigDecimal.ONE);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(saleService.createSale(any())).thenReturn(sale(new BigDecimal("950.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            ArgumentCaptor<SaleRequest> captor = ArgumentCaptor.forClass(SaleRequest.class);
            verify(saleService).createSale(captor.capture());
            SaleRequest.SaleItemRequest billed = captor.getValue().getItems().get(0);

            // Two of three left, so two thirds of the discount.
            assertThat(billed.getQuantity()).isEqualByComparingTo("2");
            assertThat(billed.getDiscountAmount()).isEqualByComparingTo("200.00");
        }

        @Test
        @DisplayName("An untouched discounted line still bills its discount in full")
        void shouldKeepWholeDiscountWhenNothingVoided() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity kottu = item(order, "Kottu", "3", "950.00");
            kottu.setDiscountAmount(new BigDecimal("300.00"));

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(saleService.createSale(any())).thenReturn(sale(new BigDecimal("950.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            ArgumentCaptor<SaleRequest> captor = ArgumentCaptor.forClass(SaleRequest.class);
            verify(saleService).createSale(captor.capture());
            assertThat(captor.getValue().getItems().get(0).getDiscountAmount())
                    .isEqualByComparingTo("300.00");
        }

        @Test
        @DisplayName("An unchanged price reports nothing")
        void shouldReportNoRepricingWhenStable() {
            RestaurantOrderEntity order = order();
            item(order, "Kottu", "1", "950.00");

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(saleService.createSale(any())).thenReturn(sale(new BigDecimal("950.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.SettleResponse response = orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            assertThat(response.getRepricedLines()).isEmpty();
        }

        @Test
        @DisplayName("Voiding a whole order frees the table without touching the money path")
        void shouldVoidOrder() {
            RestaurantOrderEntity order = order();
            item(order, "Kottu", "1", "950.00");
            table.setStatus(RestaurantTableEntity.TableStatus.OCCUPIED);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            orderService.voidOrder(order.getId());

            assertThat(order.getStatus()).isEqualTo(RestaurantOrderEntity.OrderStatus.VOIDED);
            assertThat(table.getStatus()).isEqualTo(RestaurantTableEntity.TableStatus.AVAILABLE);
            verify(saleService, never()).createSale(any());
        }
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private RestaurantOrderEntity order() {
        RestaurantOrderEntity order = RestaurantOrderEntity.builder()
                .branch(branch)
                .orderNumber(14)
                .businessDate(LocalDate.now())
                .orderType(RestaurantOrderEntity.OrderType.DINE_IN)
                .table(table)
                .status(RestaurantOrderEntity.OrderStatus.OPEN)
                .openedAt(LocalDateTime.now())
                .build();
        order.setId(UUID.randomUUID());
        order.setTenantId(tenantId);
        return order;
    }

    private RestaurantOrderItemEntity item(
            RestaurantOrderEntity order, String name, String quantity, String price) {
        RestaurantOrderItemEntity item = RestaurantOrderItemEntity.builder()
                .productId(UUID.randomUUID())
                .itemName(name)
                .quantity(new BigDecimal(quantity))
                .unitPriceSnapshot(new BigDecimal(price))
                .build();
        item.setId(UUID.randomUUID());
        order.addItem(item);
        return item;
    }

    private RestaurantOrderItemToppingEntity topping(
            RestaurantOrderItemEntity item, String name, String price, ToppingEntity.PriceMode mode) {
        RestaurantOrderItemToppingEntity row = RestaurantOrderItemToppingEntity.builder()
                .toppingId(UUID.randomUUID())
                .toppingName(name)
                .quantity(BigDecimal.ONE)
                .unitPrice(new BigDecimal(price))
                .priceMode(mode)
                .build();
        row.setId(UUID.randomUUID());
        item.addTopping(row);
        return row;
    }

    private ToppingEntity fixedTopping(String name, String defaultPrice) {
        ToppingEntity topping = ToppingEntity.builder()
                .name(name)
                .priceMode(ToppingEntity.PriceMode.FIXED)
                .defaultPrice(new BigDecimal(defaultPrice))
                .build();
        topping.setId(UUID.randomUUID());
        return topping;
    }

    private ToppingEntity promptTopping(String name, String maxPrice) {
        ToppingEntity topping = ToppingEntity.builder()
                .name(name)
                .priceMode(ToppingEntity.PriceMode.PROMPT)
                .defaultPrice(BigDecimal.ZERO)
                .maxPrice(new BigDecimal(maxPrice))
                .build();
        topping.setId(UUID.randomUUID());
        return topping;
    }

    /** A sale whose single top-level line was billed at {@code unitPrice}. */
    private SaleResponse sale(BigDecimal unitPrice) {
        return SaleResponse.builder()
                .id(UUID.randomUUID())
                .items(List.of(SaleResponse.SaleItemResponse.builder()
                        .id(UUID.randomUUID())
                        .unitPrice(unitPrice)
                        .build()))
                .build();
    }

    /** The same, plus the one child row createSale hangs off it for an add-on. */
    private SaleResponse saleWithTopping(BigDecimal unitPrice, UUID toppingId, BigDecimal toppingPrice) {
        UUID parentId = UUID.randomUUID();
        return SaleResponse.builder()
                .id(UUID.randomUUID())
                .items(List.of(
                        SaleResponse.SaleItemResponse.builder()
                                .id(parentId)
                                .unitPrice(unitPrice)
                                .build(),
                        SaleResponse.SaleItemResponse.builder()
                                .id(UUID.randomUUID())
                                .parentItemId(parentId)
                                .toppingId(toppingId)
                                .unitPrice(toppingPrice)
                                .build()))
                .build();
    }
}
