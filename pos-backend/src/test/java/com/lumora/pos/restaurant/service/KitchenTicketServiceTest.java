package com.lumora.pos.restaurant.service;

import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.entity.CategoryEntity;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.restaurant.dto.KitchenTicketDtos;
import com.lumora.pos.restaurant.entity.*;
import com.lumora.pos.restaurant.repository.KitchenTicketRepository;
import com.lumora.pos.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
@DisplayName("KitchenTicketService Unit Tests")
class KitchenTicketServiceTest {

    @Mock private KitchenTicketRepository ticketRepository;
    @Mock private ProductRepository productRepository;
    @Mock private UserRepository userRepository;
    @Mock private AuditService auditService;

    @InjectMocks private KitchenTicketService ticketService;

    private UUID tenantId;
    private RestaurantOrderEntity order;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        TenantContext.setTenantId(tenantId);

        RestaurantTableEntity table = RestaurantTableEntity.builder().name("T4").seats(4).build();
        table.setId(UUID.randomUUID());

        UserEntity server = new UserEntity();
        server.setId(UUID.randomUUID());
        server.setFirstName("Nimal");
        when(userRepository.findById(server.getId())).thenReturn(Optional.of(server));

        order = RestaurantOrderEntity.builder()
                .orderNumber(42)
                .businessDate(LocalDate.now())
                .orderType(RestaurantOrderEntity.OrderType.DINE_IN)
                .table(table)
                .covers(4)
                .servedBy(server.getId())
                .status(RestaurantOrderEntity.OrderStatus.OPEN)
                .openedAt(LocalDateTime.now())
                .build();
        order.setId(UUID.randomUUID());
        order.setTenantId(tenantId);

        when(ticketRepository.saveAll(anyIterable())).thenAnswer(inv -> {
            List<KitchenTicketEntity> out = new ArrayList<>();
            inv.<Iterable<KitchenTicketEntity>>getArgument(0).forEach(out::add);
            return out;
        });
        when(ticketRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(productRepository.findAllById(any())).thenReturn(List.of());
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    // ==================================================================
    @Nested
    @DisplayName("Firing rounds")
    class Firing {

        @Test
        @DisplayName("Fires every unsent unit, advances firedQuantity, and labels the round")
        void shouldFireFirstRound() {
            RestaurantOrderItemEntity kottu = item("Chicken kottu", "2");

            List<KitchenTicketEntity> tickets = ticketService.fireRound(order);

            assertThat(tickets).hasSize(1);
            KitchenTicketEntity ticket = tickets.get(0);
            assertThat(ticket.getLabel()).isEqualTo("#0042-R1");
            assertThat(ticket.getTicketType()).isEqualTo(KitchenTicketEntity.TicketType.ROUND);
            assertThat(ticket.getStatus()).isEqualTo(KitchenTicketEntity.TicketStatus.PENDING);
            assertThat(ticket.getStation()).isEqualTo("KITCHEN");
            assertThat(ticket.getTableName()).isEqualTo("T4");
            assertThat(ticket.getCovers()).isEqualTo(4);
            assertThat(ticket.getServerName()).isEqualTo("Nimal");
            assertThat(ticket.getItems()).singleElement()
                    .satisfies(line -> assertThat(line.getQuantity()).isEqualByComparingTo("2"));
            assertThat(kottu.getFiredQuantity()).isEqualByComparingTo("2");
            assertThat(order.getRoundCount()).isEqualTo(1);
        }

        @Test
        @DisplayName("Send fires every unsent line, whatever course number an old tab gave it")
        void shouldIgnoreLegacyCourseNumbers() {
            RestaurantOrderItemEntity soup = item("Tom yum", "2");
            RestaurantOrderItemEntity kottu = item("Chicken kottu", "2");
            kottu.setCourseNo(2);

            List<KitchenTicketEntity> tickets = ticketService.fireRound(order);

            assertThat(tickets).singleElement().satisfies(t -> {
                assertThat(t.getItems()).extracting(KitchenTicketItemEntity::getItemName)
                        .containsExactlyInAnyOrder("Tom yum", "Chicken kottu");
                assertThat(t.getNotice()).isNull();
            });
            assertThat(soup.getFiredQuantity()).isEqualByComparingTo("2");
            assertThat(kottu.getFiredQuantity()).isEqualByComparingTo("2");
        }

        @Test
        @DisplayName("A second round prints only what was added since the first")
        void shouldFireOnlyTheDelta() {
            RestaurantOrderItemEntity kottu = item("Chicken kottu", "2");
            ticketService.fireRound(order);

            kottu.setQuantity(new BigDecimal("3"));        // one more of the same
            item("Lime juice", "1");                       // and something new

            KitchenTicketEntity second = ticketService.fireRound(order).get(0);

            assertThat(second.getLabel()).isEqualTo("#0042-R2");
            assertThat(second.getItems())
                    .extracting(KitchenTicketItemEntity::getItemName, i -> i.getQuantity().stripTrailingZeros().toPlainString())
                    .containsExactly(
                            org.assertj.core.groups.Tuple.tuple("Chicken kottu", "1"),
                            org.assertj.core.groups.Tuple.tuple("Lime juice", "1"));
        }

        @Test
        @DisplayName("Nothing new to send is refused, and does not burn a round")
        void shouldRefuseEmptyRound() {
            item("Chicken kottu", "1").setFiredQuantity(BigDecimal.ONE);

            assertThatThrownBy(() -> ticketService.fireRound(order))
                    .isInstanceOf(BusinessException.class)
                    .hasMessage("Nothing new to send to the kitchen");
            assertThat(order.getRoundCount()).isZero();
        }

        @Test
        @DisplayName("Add-ons print as one line each, doubled ones with a count; no prices anywhere")
        void shouldFlattenModifiers() {
            RestaurantOrderItemEntity burger = item("Burger", "1");
            burger.setNotes("no chilli");
            topping(burger, "Extra cheese", "1");
            topping(burger, "Egg", "2");

            KitchenTicketEntity ticket = ticketService.fireRound(order).get(0);
            KitchenTicketDtos.KitchenTicketResponse response = ticketService.toResponse(ticket);

            assertThat(response.getItems().get(0).getModifiers()).containsExactly("Extra cheese", "2 x Egg");
            assertThat(response.getItems().get(0).getNotes()).isEqualTo("no chilli");
            // The response shape has no money field at all; the modifiers must not
            // smuggle one in either.
            assertThat(String.join(" ", response.getItems().get(0).getModifiers())).doesNotContainPattern("\\d+\\.\\d{2}");
        }

        @Test
        @DisplayName("The station comes from the product, then its category, then KITCHEN")
        void shouldResolveStations() {
            RestaurantOrderItemEntity beer = item("Lion lager", "1");
            RestaurantOrderItemEntity rice = item("Fried rice", "1");

            CategoryEntity drinks = new CategoryEntity();
            drinks.setKitchenStation("BAR");
            ProductEntity beerProduct = new ProductEntity();
            beerProduct.setId(beer.getProductId());
            beerProduct.setTenantId(tenantId);
            beerProduct.setCategory(drinks);
            when(productRepository.findAllById(any())).thenReturn(List.of(beerProduct));

            List<KitchenTicketEntity> tickets = ticketService.fireRound(order);

            assertThat(tickets).extracting(KitchenTicketEntity::getStation).containsExactly("BAR", "KITCHEN");
            // One round, two stations, same label: the sheets go to different printers.
            assertThat(tickets).extracting(KitchenTicketEntity::getLabel).containsOnly("#0042-R1");
            assertThat(rice.getFiredQuantity()).isEqualByComparingTo("1");
        }

        @Test
        @DisplayName("A product's own station beats its category's, whatever case it was stored in")
        void shouldPreferProductStationAndNormalize() {
            RestaurantOrderItemEntity dessert = item("Watalappan", "1");

            CategoryEntity mains = new CategoryEntity();
            mains.setKitchenStation("GRILL");
            ProductEntity product = new ProductEntity();
            product.setId(dessert.getProductId());
            product.setTenantId(tenantId);
            product.setCategory(mains);
            // Hand-edited in the DB: the till's printer map is keyed "PASTRY".
            product.setKitchenStation(" pastry ");
            when(productRepository.findAllById(any())).thenReturn(List.of(product));

            List<KitchenTicketEntity> tickets = ticketService.fireRound(order);

            assertThat(tickets).extracting(KitchenTicketEntity::getStation).containsExactly("PASTRY");
        }
    }

    // ==================================================================
    @Nested
    @DisplayName("Void tickets")
    class Voids {

        @Test
        @DisplayName("Nothing fired means no ticket and no round consumed")
        void shouldSkipWhenNothingFired() {
            RestaurantOrderItemEntity kottu = item("Chicken kottu", "2");
            Map<RestaurantOrderItemEntity, BigDecimal> portions = new LinkedHashMap<>();
            portions.put(kottu, BigDecimal.ZERO);

            assertThat(ticketService.voidPortions(order, portions, "changed mind")).isEmpty();
            assertThat(order.getRoundCount()).isZero();
            verify(ticketRepository, never()).saveAll(anyIterable());
        }

        @Test
        @DisplayName("A fired portion prints a VOID ticket for that portion only, as the next round")
        void shouldPrintVoidForFiredPortion() {
            RestaurantOrderItemEntity kottu = item("Chicken kottu", "3");
            ticketService.fireRound(order);
            Map<RestaurantOrderItemEntity, BigDecimal> portions = new LinkedHashMap<>();
            portions.put(kottu, BigDecimal.ONE);

            KitchenTicketEntity ticket = ticketService.voidPortions(order, portions, "dropped").get(0);

            assertThat(ticket.getTicketType()).isEqualTo(KitchenTicketEntity.TicketType.VOID);
            assertThat(ticket.getLabel()).isEqualTo("#0042-R2-VOID");
            assertThat(ticket.getItems()).singleElement()
                    .satisfies(line -> assertThat(line.getQuantity()).isEqualByComparingTo("1"));
        }
    }

    // ==================================================================
    @Nested
    @DisplayName("Move notices")
    class MoveNotices {

        @Test
        @DisplayName("Nothing cooking means no notice and no round consumed")
        void shouldSkipWhenNothingFired() {
            item("Chicken kottu", "1");

            assertThat(ticketService.moveNotice(order, "MOVED FROM T4")).isEmpty();
            assertThat(order.getRoundCount()).isZero();
        }

        @Test
        @DisplayName("With food in the kitchen, a MOVE ticket carries the notice and no lines")
        void shouldPrintMoveNotice() {
            item("Chicken kottu", "1").setFiredQuantity(BigDecimal.ONE);
            order.setRoundCount(1);

            KitchenTicketEntity ticket = ticketService.moveNotice(order, "MOVED FROM T4").get(0);

            assertThat(ticket.getTicketType()).isEqualTo(KitchenTicketEntity.TicketType.MOVE);
            assertThat(ticket.getLabel()).isEqualTo("#0042-R2-MOVE");
            assertThat(ticket.getNotice()).isEqualTo("MOVED FROM T4");
            assertThat(ticket.getTableName()).isEqualTo("T4");
            assertThat(ticket.getItems()).isEmpty();
        }
    }

    // ==================================================================
    @Nested
    @DisplayName("After the print")
    class AfterPrint {

        @Test
        @DisplayName("A reprint goes back to PENDING and touches neither the round nor what was fired")
        void shouldReprintWithoutRefiring() {
            RestaurantOrderItemEntity kottu = item("Chicken kottu", "2");
            KitchenTicketEntity ticket = ticketService.fireRound(order).get(0);
            ticket.setStatus(KitchenTicketEntity.TicketStatus.PRINTED);
            ticket.setId(UUID.randomUUID());
            when(ticketRepository.findByIdAndTenantId(ticket.getId(), tenantId)).thenReturn(Optional.of(ticket));

            KitchenTicketDtos.KitchenTicketResponse reprint = ticketService.reprint(ticket.getId());

            assertThat(reprint.getLabel()).isEqualTo("#0042-R1");
            assertThat(reprint.getStatus()).isEqualTo(KitchenTicketEntity.TicketStatus.PENDING);
            assertThat(order.getRoundCount()).isEqualTo(1);
            assertThat(kottu.getFiredQuantity()).isEqualByComparingTo("2");
        }

        @Test
        @DisplayName("A failed print is recorded with a readable error, and counts as an attempt")
        void shouldRecordFailure() {
            KitchenTicketEntity ticket = storedTicket();

            KitchenTicketDtos.KitchenTicketResponse response = ticketService.acknowledge(ticket.getId(),
                    KitchenTicketDtos.AckRequest.builder().outcome(KitchenTicketDtos.AckOutcome.FAILED).build());

            assertThat(response.getStatus()).isEqualTo(KitchenTicketEntity.TicketStatus.FAILED);
            assertThat(response.getLastError()).isEqualTo("The kitchen printer did not respond");
            assertThat(response.getPrintAttempts()).isEqualTo(1);
        }

        @Test
        @DisplayName("Marking a ticket handled resolves it but keeps who-said-what on the record")
        void shouldRecordHandledByHand() {
            KitchenTicketEntity ticket = storedTicket();
            ticket.setStatus(KitchenTicketEntity.TicketStatus.FAILED);

            KitchenTicketDtos.KitchenTicketResponse response = ticketService.acknowledge(ticket.getId(),
                    KitchenTicketDtos.AckRequest.builder()
                            .outcome(KitchenTicketDtos.AckOutcome.HANDLED)
                            .note("Told the chef at the pass")
                            .build());

            assertThat(response.getStatus()).isEqualTo(KitchenTicketEntity.TicketStatus.PRINTED);
            assertThat(response.getLastError()).isEqualTo("Handled by hand: Told the chef at the pass");
            assertThat(response.getPrintedAt()).isNull();
        }

        @Test
        @DisplayName("A successful print clears an earlier error")
        void shouldClearErrorOnSuccess() {
            KitchenTicketEntity ticket = storedTicket();
            ticket.setStatus(KitchenTicketEntity.TicketStatus.FAILED);
            ticket.setLastError("Paper out");

            KitchenTicketDtos.KitchenTicketResponse response = ticketService.acknowledge(ticket.getId(),
                    KitchenTicketDtos.AckRequest.builder().outcome(KitchenTicketDtos.AckOutcome.PRINTED).build());

            assertThat(response.getStatus()).isEqualTo(KitchenTicketEntity.TicketStatus.PRINTED);
            assertThat(response.getLastError()).isNull();
            assertThat(response.getPrintedAt()).isNotNull();
        }
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private RestaurantOrderItemEntity item(String name, String quantity) {
        RestaurantOrderItemEntity item = RestaurantOrderItemEntity.builder()
                .productId(UUID.randomUUID())
                .itemName(name)
                .quantity(new BigDecimal(quantity))
                .unitPriceSnapshot(new BigDecimal("950.00"))
                .build();
        item.setId(UUID.randomUUID());
        order.addItem(item);
        return item;
    }

    private void topping(RestaurantOrderItemEntity item, String name, String quantity) {
        RestaurantOrderItemToppingEntity row = RestaurantOrderItemToppingEntity.builder()
                .toppingId(UUID.randomUUID())
                .toppingName(name)
                .quantity(new BigDecimal(quantity))
                .unitPrice(new BigDecimal("150.00"))
                .priceMode(ToppingEntity.PriceMode.FIXED)
                .build();
        item.addTopping(row);
    }

    private KitchenTicketEntity storedTicket() {
        KitchenTicketEntity ticket = KitchenTicketEntity.builder()
                .order(order)
                .ticketType(KitchenTicketEntity.TicketType.ROUND)
                .roundNo(1)
                .label("#0042-R1")
                .orderNumber(42)
                .orderType(RestaurantOrderEntity.OrderType.DINE_IN)
                .build();
        ticket.setId(UUID.randomUUID());
        ticket.setTenantId(tenantId);
        when(ticketRepository.findByIdAndTenantId(ticket.getId(), tenantId)).thenReturn(Optional.of(ticket));
        return ticket;
    }
}
