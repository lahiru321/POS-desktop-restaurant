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
import com.lumora.pos.restaurant.repository.RestaurantOrderItemRepository;
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
import java.util.Map;
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
    @Mock private RestaurantOrderItemRepository itemRepository;
    @Mock private RestaurantTableRepository tableRepository;
    @Mock private RestaurantOrderCounterDao counterDao;
    @Mock private ProductRepository productRepository;
    @Mock private ToppingRepository toppingRepository;
    @Mock private BranchRepository branchRepository;
    @Mock private UserRepository userRepository;
    @Mock private SaleService saleService;
    @Mock private KitchenTicketService kitchenTicketService;
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
            stubLockedOrder(order);

            OrderDtos.OrderKitchenResponse response = orderService.voidItem(order.getId(), item.getId(),
                    OrderDtos.VoidItemRequest.builder().quantity(new BigDecimal("1")).reason("dropped").build());

            assertThat(response.getOrder().getItems().get(0).getVoidedQuantity()).isEqualByComparingTo("1");
            assertThat(response.getOrder().getItems().get(0).getBillableQuantity()).isEqualByComparingTo("2");
        }

        @Test
        @DisplayName("Voiding a line the kitchen never saw prints nothing")
        void shouldNotTellKitchenAboutUnsentVoid() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity item = item(order, "Kottu", "2", "950.00");
            stubLockedOrder(order);

            orderService.voidItem(order.getId(), item.getId(),
                    OrderDtos.VoidItemRequest.builder().quantity(BigDecimal.ONE).build());

            assertThat(firedPortionPassedFor(order, item)).isEqualByComparingTo("0");
            assertThat(item.getFiredQuantity()).isEqualByComparingTo("0");
            assertThat(item.pendingQuantity()).isEqualByComparingTo("1");
        }

        @Test
        @DisplayName("A void takes unsent units first; only the fired remainder reaches the kitchen")
        void shouldVoidUnsentFirstThenFired() {
            RestaurantOrderEntity order = order();
            // 3 ordered, 2 already with the kitchen, 1 still unsent.
            RestaurantOrderItemEntity item = item(order, "Kottu", "3", "950.00");
            item.setFiredQuantity(new BigDecimal("2"));
            stubLockedOrder(order);

            orderService.voidItem(order.getId(), item.getId(),
                    OrderDtos.VoidItemRequest.builder().quantity(new BigDecimal("2")).reason("changed mind").build());

            // 1 of the 2 came off the unsent unit; the other was cooking.
            assertThat(firedPortionPassedFor(order, item)).isEqualByComparingTo("1");
            assertThat(item.getFiredQuantity()).isEqualByComparingTo("1");
            assertThat(item.getVoidedQuantity()).isEqualByComparingTo("2");
            assertThat(item.pendingQuantity()).isEqualByComparingTo("0");
        }

        @Test
        @DisplayName("Voiding more than is left is refused")
        void shouldRefuseOverVoid() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity item = item(order, "Kottu", "2", "950.00");

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));

            assertThatThrownBy(() -> orderService.voidItem(order.getId(), item.getId(),
                    OrderDtos.VoidItemRequest.builder().quantity(new BigDecimal("5")).build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("only 2 left");
        }

        @Test
        @DisplayName("Fire hands the locked order to the ticket service and saves the advance")
        void shouldFireThroughLockedOrder() {
            RestaurantOrderEntity order = order();
            item(order, "Kottu", "2", "950.00");
            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(kitchenTicketService.fireRound(order)).thenReturn(List.of());

            orderService.fire(order.getId());

            verify(kitchenTicketService).fireRound(order);
            verify(orderRepository).save(order);
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
        @DisplayName("A dine-in settle never fires the kitchen, even with unsent lines")
        void shouldNotFireOnDineInSettle() {
            RestaurantOrderEntity order = order();
            item(order, "Kottu", "1", "950.00");       // never sent

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(saleService.createSale(any())).thenReturn(sale(new BigDecimal("950.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            OrderDtos.SettleResponse response = orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            verify(kitchenTicketService, never()).fireRound(any());
            assertThat(response.getTickets()).isEmpty();
        }

        @Test
        @DisplayName("A takeaway settle pays, then fires whatever the kitchen has not seen")
        void shouldFireOnTakeawaySettle() {
            RestaurantOrderEntity order = order();
            order.setOrderType(RestaurantOrderEntity.OrderType.TAKEAWAY);
            order.setTable(null);
            item(order, "Kottu", "2", "950.00");

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(saleService.createSale(any())).thenReturn(sale(new BigDecimal("1900.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(kitchenTicketService.fireRound(order)).thenReturn(List.of());

            orderService.settle(order.getId(), OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            // Paid first, then fired — a refused payment must never reach the kitchen.
            var inOrder = inOrder(saleService, kitchenTicketService);
            inOrder.verify(saleService).createSale(any());
            inOrder.verify(kitchenTicketService).fireRound(order);
        }

        @Test
        @DisplayName("A takeaway already fully sent settles without a second ticket")
        void shouldNotRefireSentTakeaway() {
            RestaurantOrderEntity order = order();
            order.setOrderType(RestaurantOrderEntity.OrderType.TAKEAWAY);
            order.setTable(null);
            item(order, "Kottu", "1", "950.00").setFiredQuantity(BigDecimal.ONE);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(saleService.createSale(any())).thenReturn(sale(new BigDecimal("950.00")));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            orderService.settle(order.getId(), OrderDtos.SettleRequest.builder().paymentMethod("CASH").build());

            verify(kitchenTicketService, never()).fireRound(any());
        }

        @Test
        @DisplayName("A refused takeaway payment fires nothing")
        void shouldNotFireWhenPaymentRefused() {
            RestaurantOrderEntity order = order();
            order.setOrderType(RestaurantOrderEntity.OrderType.TAKEAWAY);
            order.setTable(null);
            item(order, "Kottu", "1", "950.00");

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                    .thenReturn(Optional.of(order));
            when(saleService.createSale(any())).thenThrow(new BusinessException("Insufficient stock"));

            assertThatThrownBy(() -> orderService.settle(order.getId(),
                    OrderDtos.SettleRequest.builder().paymentMethod("CASH").build()))
                    .isInstanceOf(BusinessException.class);
            verify(kitchenTicketService, never()).fireRound(any());
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
            stubLockedOrder(order);

            orderService.voidOrder(order.getId());

            assertThat(order.getStatus()).isEqualTo(RestaurantOrderEntity.OrderStatus.VOIDED);
            assertThat(table.getStatus()).isEqualTo(RestaurantTableEntity.TableStatus.AVAILABLE);
            verify(saleService, never()).createSale(any());
        }

        @Test
        @DisplayName("Voiding a whole order tells the kitchen to stop exactly what it was cooking")
        void shouldVoidFiredPortionsOfWholeOrder() {
            RestaurantOrderEntity order = order();
            RestaurantOrderItemEntity cooking = item(order, "Kottu", "3", "950.00");
            cooking.setFiredQuantity(new BigDecimal("2"));
            RestaurantOrderItemEntity unsent = item(order, "Lime juice", "1", "300.00");
            stubLockedOrder(order);

            orderService.voidOrder(order.getId());

            assertThat(firedPortionPassedFor(order, cooking)).isEqualByComparingTo("2");
            assertThat(firedPortionPassedFor(order, unsent)).isEqualByComparingTo("0");
            assertThat(cooking.getVoidedQuantity()).isEqualByComparingTo("3");
            assertThat(cooking.getFiredQuantity()).isEqualByComparingTo("0");
        }
    }

    // ==================================================================
    @Nested
    @DisplayName("Split bills")
    class Splitting {

        /** The tab under lock, and the split order it spawns, both findable by id. */
        private RestaurantOrderEntity[] stubSplit(RestaurantOrderEntity tab) {
            RestaurantOrderEntity[] split = new RestaurantOrderEntity[1];
            when(orderRepository.findByIdAndTenantIdForUpdate(any(), eq(tenantId))).thenAnswer(inv -> {
                UUID id = inv.getArgument(0);
                if (id.equals(tab.getId())) return Optional.of(tab);
                return split[0] != null && id.equals(split[0].getId()) ? Optional.of(split[0]) : Optional.empty();
            });
            when(counterDao.nextOrderNumber(any(), any(), any())).thenReturn(15);
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(orderRepository.saveAndFlush(any())).thenAnswer(inv -> {
                RestaurantOrderEntity o = inv.getArgument(0);
                o.setId(UUID.randomUUID());
                split[0] = o;
                return o;
            });
            when(saleService.createSale(any())).thenReturn(sale(new BigDecimal("950.00")));
            return split;
        }

        private OrderDtos.SplitSettleRequest paying(RestaurantOrderItemEntity item, String qty) {
            return OrderDtos.SplitSettleRequest.builder()
                    .paymentMethod("CASH")
                    .lines(List.of(OrderDtos.SplitLine.builder()
                            .itemId(item.getId()).quantity(new BigDecimal(qty)).build()))
                    .build();
        }

        @Test
        @DisplayName("Paying for 1 of 3 moves that unit, with its fired share, onto a settled split")
        void shouldSplitOffUnits() {
            RestaurantOrderEntity tab = order();
            RestaurantOrderItemEntity kottu = item(tab, "Kottu", "3", "950.00");
            kottu.setFiredQuantity(new BigDecimal("3"));
            RestaurantOrderEntity[] split = stubSplit(tab);

            OrderDtos.SettleResponse response = orderService.splitSettle(tab.getId(), paying(kottu, "1"));

            assertThat(kottu.getQuantity()).isEqualByComparingTo("2");
            assertThat(kottu.getFiredQuantity()).isEqualByComparingTo("2");
            assertThat(tab.getStatus()).isEqualTo(RestaurantOrderEntity.OrderStatus.OPEN);

            RestaurantOrderEntity paid = split[0];
            assertThat(paid.getSplitFromId()).isEqualTo(tab.getId());
            assertThat(paid.getTable()).isNull();
            assertThat(paid.getStatus()).isEqualTo(RestaurantOrderEntity.OrderStatus.SETTLED);
            assertThat(paid.getItems()).singleElement().satisfies(line -> {
                assertThat(line.getQuantity()).isEqualByComparingTo("1");
                assertThat(line.getFiredQuantity()).isEqualByComparingTo("1");
            });
            assertThat(response.getLabel()).isEqualTo("Order 15 · Split bill");

            ArgumentCaptor<SaleRequest> sale = ArgumentCaptor.forClass(SaleRequest.class);
            verify(saleService).createSale(sale.capture());
            assertThat(sale.getValue().getItems()).singleElement()
                    .satisfies(l -> assertThat(l.getQuantity()).isEqualByComparingTo("1"));
            // The table's tab is still open: its table stays occupied.
            verify(kitchenTicketService, never()).fireRound(any());
        }

        @Test
        @DisplayName("A line paid for in full leaves the tab; the rest of the tab stays")
        void shouldRemoveFullyPaidLine() {
            RestaurantOrderEntity tab = order();
            RestaurantOrderItemEntity juice = item(tab, "Lime juice", "1", "300.00");
            item(tab, "Kottu", "1", "950.00");
            stubSplit(tab);

            orderService.splitSettle(tab.getId(), paying(juice, "1"));

            assertThat(tab.getItems()).extracting(RestaurantOrderItemEntity::getItemName).containsExactly("Kottu");
        }

        @Test
        @DisplayName("A line discount is shared in proportion, so tab + split bill what the tab would")
        void shouldShareDiscount() {
            RestaurantOrderEntity tab = order();
            RestaurantOrderItemEntity kottu = item(tab, "Kottu", "3", "950.00");
            kottu.setDiscountAmount(new BigDecimal("90.00"));
            RestaurantOrderEntity[] split = stubSplit(tab);

            orderService.splitSettle(tab.getId(), paying(kottu, "1"));

            assertThat(split[0].getItems().get(0).getDiscountAmount()).isEqualByComparingTo("30.00");
            assertThat(kottu.getDiscountAmount()).isEqualByComparingTo("60.00");
        }

        @Test
        @DisplayName("Picking the whole tab is refused — that is a settle, not a split")
        void shouldRefuseWholeTab() {
            RestaurantOrderEntity tab = order();
            RestaurantOrderItemEntity kottu = item(tab, "Kottu", "2", "950.00");
            when(orderRepository.findByIdAndTenantIdForUpdate(tab.getId(), tenantId)).thenReturn(Optional.of(tab));

            assertThatThrownBy(() -> orderService.splitSettle(tab.getId(), paying(kottu, "2")))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("whole tab");
            verify(saleService, never()).createSale(any());
        }

        @Test
        @DisplayName("Paying for more than is left on a line is refused")
        void shouldRefuseOverQuantity() {
            RestaurantOrderEntity tab = order();
            RestaurantOrderItemEntity kottu = item(tab, "Kottu", "2", "950.00");
            kottu.setVoidedQuantity(BigDecimal.ONE);
            item(tab, "Lime juice", "1", "300.00");
            when(orderRepository.findByIdAndTenantIdForUpdate(tab.getId(), tenantId)).thenReturn(Optional.of(tab));

            assertThatThrownBy(() -> orderService.splitSettle(tab.getId(), paying(kottu, "2")))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("Only 1 of Kottu left");
        }
    }

    // ==================================================================
    @Nested
    @DisplayName("Moving and merging tabs")
    class MoveAndMerge {

        private RestaurantTableEntity otherTable() {
            RestaurantTableEntity t7 = RestaurantTableEntity.builder().area(table.getArea()).name("T7").seats(4).build();
            t7.setId(UUID.randomUUID());
            t7.setTenantId(tenantId);
            return t7;
        }

        @Test
        @DisplayName("Moving frees the old table, occupies the new one, and tells the kitchen")
        void shouldMoveToFreeTable() {
            RestaurantOrderEntity order = order();
            item(order, "Kottu", "1", "950.00").setFiredQuantity(BigDecimal.ONE);
            table.setStatus(RestaurantTableEntity.TableStatus.OCCUPIED);
            RestaurantTableEntity t7 = otherTable();

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId)).thenReturn(Optional.of(order));
            when(tableRepository.findByIdAndTenantId(t7.getId(), tenantId)).thenReturn(Optional.of(t7));
            when(orderRepository.findOpenByTableId(tenantId, t7.getId())).thenReturn(Optional.empty());
            when(orderRepository.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(kitchenTicketService.moveNotice(eq(order), any())).thenReturn(List.of());

            OrderDtos.OrderKitchenResponse response = orderService.move(order.getId(),
                    OrderDtos.MoveOrderRequest.builder().tableId(t7.getId()).build());

            assertThat(response.getOrder().getTableName()).isEqualTo("T7");
            assertThat(table.getStatus()).isEqualTo(RestaurantTableEntity.TableStatus.AVAILABLE);
            assertThat(t7.getStatus()).isEqualTo(RestaurantTableEntity.TableStatus.OCCUPIED);
            verify(kitchenTicketService).moveNotice(order, "MOVED FROM T1");
        }

        @Test
        @DisplayName("Moving onto a table with its own tab is refused, pointing at merge")
        void shouldRefuseMoveOntoOccupiedTable() {
            RestaurantOrderEntity order = order();
            RestaurantTableEntity t7 = otherTable();
            RestaurantOrderEntity there = order();
            there.setOrderNumber(15);

            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId)).thenReturn(Optional.of(order));
            when(tableRepository.findByIdAndTenantId(t7.getId(), tenantId)).thenReturn(Optional.of(t7));
            when(orderRepository.findOpenByTableId(tenantId, t7.getId())).thenReturn(Optional.of(there));

            assertThatThrownBy(() -> orderService.move(order.getId(),
                    OrderDtos.MoveOrderRequest.builder().tableId(t7.getId()).build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("Merge the two tabs instead");
            assertThat(order.getTable()).isSameAs(table);
        }

        @Test
        @DisplayName("A takeaway has no table to move")
        void shouldRefuseMovingTakeaway() {
            RestaurantOrderEntity order = order();
            order.setOrderType(RestaurantOrderEntity.OrderType.TAKEAWAY);
            order.setTable(null);
            when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId)).thenReturn(Optional.of(order));

            assertThatThrownBy(() -> orderService.move(order.getId(),
                    OrderDtos.MoveOrderRequest.builder().tableId(UUID.randomUUID()).build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("no table");
        }

        @Test
        @DisplayName("Merging moves the lines in place, sums covers, frees the source table")
        void shouldMerge() {
            RestaurantOrderEntity target = order();
            target.setCovers(2);
            RestaurantTableEntity t7 = otherTable();
            RestaurantOrderEntity source = order();
            source.setOrderNumber(9);
            source.setTable(t7);
            source.setCovers(3);
            t7.setStatus(RestaurantTableEntity.TableStatus.OCCUPIED);
            item(source, "Lime juice", "1", "300.00").setFiredQuantity(BigDecimal.ONE);

            when(orderRepository.findByIdAndTenantIdForUpdate(target.getId(), tenantId)).thenReturn(Optional.of(target));
            when(orderRepository.findByIdAndTenantIdForUpdate(source.getId(), tenantId)).thenReturn(Optional.of(source));
            when(itemRepository.reassignLines(source, target, tenantId)).thenReturn(1);
            when(orderRepository.findByIdAndTenantId(target.getId(), tenantId)).thenReturn(Optional.of(target));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
            when(kitchenTicketService.moveNotice(eq(target), any())).thenReturn(List.of());

            orderService.merge(target.getId(),
                    OrderDtos.MergeOrderRequest.builder().sourceOrderId(source.getId()).build());

            assertThat(source.getStatus()).isEqualTo(RestaurantOrderEntity.OrderStatus.MERGED);
            assertThat(t7.getStatus()).isEqualTo(RestaurantTableEntity.TableStatus.AVAILABLE);
            assertThat(target.getCovers()).isEqualTo(5);
            verify(itemRepository).reassignLines(source, target, tenantId);
            // The source's food was cooking, so the runner is told where it now goes.
            verify(kitchenTicketService).moveNotice(target, "ORDER 9 FROM T7 JOINS");
        }

        @Test
        @DisplayName("Merging a tab the kitchen never saw prints nothing")
        void shouldMergeQuietlyWhenNothingFired() {
            RestaurantOrderEntity target = order();
            RestaurantOrderEntity source = order();
            source.setTable(otherTable());
            item(source, "Lime juice", "1", "300.00");

            when(orderRepository.findByIdAndTenantIdForUpdate(target.getId(), tenantId)).thenReturn(Optional.of(target));
            when(orderRepository.findByIdAndTenantIdForUpdate(source.getId(), tenantId)).thenReturn(Optional.of(source));
            when(orderRepository.findByIdAndTenantId(target.getId(), tenantId)).thenReturn(Optional.of(target));
            when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

            orderService.merge(target.getId(),
                    OrderDtos.MergeOrderRequest.builder().sourceOrderId(source.getId()).build());

            verify(kitchenTicketService, never()).moveNotice(any(), any());
        }

        @Test
        @DisplayName("A tab cannot be merged into itself")
        void shouldRefuseSelfMerge() {
            UUID id = UUID.randomUUID();
            assertThatThrownBy(() -> orderService.merge(id,
                    OrderDtos.MergeOrderRequest.builder().sourceOrderId(id).build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("into itself");
        }

        @Test
        @DisplayName("Tabs on different branches cannot become one bill")
        void shouldRefuseCrossBranchMerge() {
            RestaurantOrderEntity target = order();
            RestaurantOrderEntity source = order();
            BranchEntity other = new BranchEntity();
            other.setId(UUID.randomUUID());
            source.setBranch(other);

            when(orderRepository.findByIdAndTenantIdForUpdate(target.getId(), tenantId)).thenReturn(Optional.of(target));
            when(orderRepository.findByIdAndTenantIdForUpdate(source.getId(), tenantId)).thenReturn(Optional.of(source));

            assertThatThrownBy(() -> orderService.merge(target.getId(),
                    OrderDtos.MergeOrderRequest.builder().sourceOrderId(source.getId()).build()))
                    .isInstanceOf(BusinessException.class)
                    .hasMessageContaining("different branches");
            verify(itemRepository, never()).reassignLines(any(), any(), any());
        }
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** The row-locked read every printing operation goes through, plus a save
     *  that hands the order back and a ticket service that prints nothing. */
    private void stubLockedOrder(RestaurantOrderEntity order) {
        when(orderRepository.findByIdAndTenantIdForUpdate(order.getId(), tenantId))
                .thenReturn(Optional.of(order));
        when(orderRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(kitchenTicketService.voidPortions(eq(order), any(), any())).thenReturn(List.of());
    }

    /** What the order service asked the kitchen to stop cooking for one line. */
    @SuppressWarnings("unchecked")
    private BigDecimal firedPortionPassedFor(RestaurantOrderEntity order, RestaurantOrderItemEntity item) {
        ArgumentCaptor<Map<RestaurantOrderItemEntity, BigDecimal>> captor = ArgumentCaptor.forClass(Map.class);
        verify(kitchenTicketService).voidPortions(eq(order), captor.capture(), any());
        return captor.getValue().getOrDefault(item, BigDecimal.ZERO);
    }

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
