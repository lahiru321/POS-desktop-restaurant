package com.lumora.pos.restaurant.service;

import com.lumora.pos.audit.AuditAction;
import com.lumora.pos.audit.service.AuditService;
import com.lumora.pos.auth.repository.UserRepository;
import com.lumora.pos.common.exception.BusinessException;
import com.lumora.pos.inventory.entity.ProductEntity;
import com.lumora.pos.inventory.repository.ProductRepository;
import com.lumora.pos.restaurant.dto.KitchenTicketDtos;
import com.lumora.pos.restaurant.entity.*;
import com.lumora.pos.restaurant.repository.KitchenTicketRepository;
import com.lumora.pos.tenant.TenantContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Turns order changes into paper for the kitchen, and tracks whether it arrived.
 *
 * <p>The contract with the till is persist, then print, then acknowledge. Every
 * ticket is saved {@code PENDING} inside the same transaction that changed the
 * order, so the record of what the kitchen should have been told can never be
 * lost to a crash between the two. The till then prints it and reports back.
 *
 * <p>{@code firedQuantity} advances at fire time, not at acknowledgement. The
 * ticket row is the durable snapshot of what was sent, so recovering from a
 * failed print is "reprint #0042-R2" — never "recompute the delta", which would
 * double-fire anything added since.
 *
 * <p>The methods that create tickets take an order the caller has already
 * locked ({@code findByIdAndTenantIdForUpdate}): two servers pressing Send on
 * one table must queue, not both print the same round.
 */
@Service
@RequiredArgsConstructor
public class KitchenTicketService {

    /** How long a ticket may sit PENDING before it counts as unresolved. A
     *  normal print acknowledges within a second or two; flashing the badge for
     *  that would teach people to ignore it. */
    static final long PENDING_GRACE_SECONDS = 30;

    private static final String HANDLED_PREFIX = "Handled by hand: ";

    private final KitchenTicketRepository ticketRepository;
    private final ProductRepository productRepository;
    private final UserRepository userRepository;
    private final AuditService auditService;

    // ------------------------------------------------------------------
    // Creating tickets — callers hold the order's row lock
    // ------------------------------------------------------------------

    /**
     * Fires everything the kitchen has not been told about yet, as one round.
     *
     * <p>One ticket per station, all sharing the round number. Every station
     * prints to the one kitchen printer today, so in practice this is one ticket.
     */
    @Transactional
    public List<KitchenTicketEntity> fireRound(RestaurantOrderEntity order) {
        List<RestaurantOrderItemEntity> pending = order.getItems().stream()
                .filter(i -> i.pendingQuantity().signum() > 0)
                .toList();
        if (pending.isEmpty()) {
            throw new BusinessException("Nothing new to send to the kitchen");
        }

        int round = nextRound(order);
        Map<UUID, String> stations = resolveStations(pending);
        Map<String, KitchenTicketEntity> byStation = new LinkedHashMap<>();
        for (RestaurantOrderItemEntity item : pending) {
            BigDecimal delta = item.pendingQuantity();
            KitchenTicketEntity ticket = byStation.computeIfAbsent(stationOf(item, stations),
                    station -> newTicket(order, KitchenTicketEntity.TicketType.ROUND, round, station));
            ticket.addItem(snapshot(item, delta, ticket.getItems().size()));
            item.setFiredQuantity(item.getFiredQuantity().add(delta));
        }

        List<KitchenTicketEntity> saved = ticketRepository.saveAll(byStation.values());
        for (KitchenTicketEntity ticket : saved) {
            auditService.log(AuditAction.KITCHEN_TICKET_FIRE, "KITCHEN_TICKET", ticket.getId(), null,
                    Map.of("label", ticket.getLabel(), "lines", ticket.getItems().size()));
        }
        return saved;
    }

    /**
     * A VOID ticket for portions the kitchen was already cooking.
     *
     * <p>Only the fired portion of a void reaches the kitchen — a unit that was
     * never sent is reduced silently, because there is nothing to un-cook. The
     * caller works out that split; this prints whatever it is handed.
     *
     * @param portions order line → how much of it to stop cooking; entries at or
     *                 below zero are ignored
     * @return the tickets written, or an empty list when there was nothing fired
     */
    @Transactional
    public List<KitchenTicketEntity> voidPortions(
            RestaurantOrderEntity order, Map<RestaurantOrderItemEntity, BigDecimal> portions, String reason) {
        Map<RestaurantOrderItemEntity, BigDecimal> fired = new LinkedHashMap<>();
        portions.forEach((item, qty) -> {
            if (qty != null && qty.signum() > 0) {
                fired.put(item, qty);
            }
        });
        if (fired.isEmpty()) {
            return List.of();
        }

        int round = nextRound(order);
        Map<UUID, String> stations = resolveStations(fired.keySet());
        Map<String, KitchenTicketEntity> byStation = new LinkedHashMap<>();
        fired.forEach((item, qty) -> {
            KitchenTicketEntity ticket = byStation.computeIfAbsent(stationOf(item, stations),
                    station -> newTicket(order, KitchenTicketEntity.TicketType.VOID, round, station));
            ticket.addItem(snapshot(item, qty, ticket.getItems().size()));
        });

        List<KitchenTicketEntity> saved = ticketRepository.saveAll(byStation.values());
        for (KitchenTicketEntity ticket : saved) {
            auditService.log(AuditAction.KITCHEN_TICKET_VOID, "KITCHEN_TICKET", ticket.getId(), null,
                    Map.of("label", ticket.getLabel(), "reason", reason == null ? "" : reason));
        }
        return saved;
    }

    /**
     * A notice that food already sent now goes to another table. Printed only
     * when the kitchen has something for this tab — moving a tab nobody has
     * cooked for yet tells the kitchen nothing it needs to know.
     *
     * @return the ticket, or empty when nothing on the order has been fired
     */
    @Transactional
    public List<KitchenTicketEntity> moveNotice(RestaurantOrderEntity order, String notice) {
        boolean anythingCooking = order.getItems().stream().anyMatch(i -> i.getFiredQuantity().signum() > 0);
        if (!anythingCooking) {
            return List.of();
        }
        KitchenTicketEntity ticket = newTicket(order, KitchenTicketEntity.TicketType.MOVE, nextRound(order),
                KitchenTicketEntity.DEFAULT_STATION);
        ticket.setNotice(truncate(notice, 255));
        KitchenTicketEntity saved = ticketRepository.save(ticket);
        auditService.log(AuditAction.KITCHEN_TICKET_FIRE, "KITCHEN_TICKET", saved.getId(), null,
                Map.of("label", saved.getLabel(), "notice", saved.getNotice()));
        return List.of(saved);
    }

    // ------------------------------------------------------------------
    // After the print
    // ------------------------------------------------------------------

    /**
     * Records what happened when the till tried to print.
     *
     * <p>{@code HANDLED} resolves a ticket that never printed, because a person
     * said they told the kitchen themselves. It is stored as PRINTED — the badge
     * clears — with the note kept in {@code lastError}, so the record shows that
     * a human, not a printer, closed it.
     */
    @Transactional
    public KitchenTicketDtos.KitchenTicketResponse acknowledge(UUID ticketId, KitchenTicketDtos.AckRequest request) {
        KitchenTicketEntity ticket = require(ticketId);
        ticket.setPrintAttempts(ticket.getPrintAttempts() + 1);

        switch (request.getOutcome()) {
            case PRINTED -> {
                ticket.setStatus(KitchenTicketEntity.TicketStatus.PRINTED);
                ticket.setPrintedAt(LocalDateTime.now());
                ticket.setLastError(null);
            }
            case FAILED -> {
                ticket.setStatus(KitchenTicketEntity.TicketStatus.FAILED);
                ticket.setLastError(truncate(request.getNote() == null || request.getNote().isBlank()
                        ? "The kitchen printer did not respond" : request.getNote().trim()));
                auditService.log(AuditAction.KITCHEN_PRINT_FAILED, "KITCHEN_TICKET", ticket.getId(), null,
                        Map.of("label", ticket.getLabel(), "error", ticket.getLastError()));
            }
            case HANDLED -> {
                ticket.setStatus(KitchenTicketEntity.TicketStatus.PRINTED);
                ticket.setLastError(truncate(HANDLED_PREFIX + request.getNote().trim()));
                auditService.log(AuditAction.KITCHEN_PRINT_HANDLED, "KITCHEN_TICKET", ticket.getId(), null,
                        Map.of("label", ticket.getLabel(), "note", request.getNote().trim()));
            }
        }
        return toResponse(ticketRepository.save(ticket));
    }

    /**
     * The stored sheet, to print again.
     *
     * <p>Touches neither the order's {@code roundCount} nor any line's
     * {@code firedQuantity}: a reprint is the same instruction on new paper, not
     * new work. The ticket goes back to PENDING so a reprint that fails is
     * tracked exactly like a first print that fails.
     */
    @Transactional
    public KitchenTicketDtos.KitchenTicketResponse reprint(UUID ticketId) {
        KitchenTicketEntity ticket = require(ticketId);
        ticket.setStatus(KitchenTicketEntity.TicketStatus.PENDING);
        KitchenTicketEntity saved = ticketRepository.save(ticket);
        auditService.log(AuditAction.KITCHEN_TICKET_REPRINT, "KITCHEN_TICKET", ticket.getId(), null,
                Map.of("label", ticket.getLabel()));
        return toResponse(saved);
    }

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    /** What the till's red badge counts: failed, or stuck pending. */
    @Transactional(readOnly = true)
    public List<KitchenTicketDtos.KitchenTicketResponse> listUnresolved() {
        return ticketRepository.findUnresolved(TenantContext.getTenantId(),
                        LocalDateTime.now().minusSeconds(PENDING_GRACE_SECONDS))
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public List<KitchenTicketDtos.KitchenTicketResponse> listForOrder(UUID orderId) {
        return ticketRepository.findAllByTenantIdAndOrder_IdOrderByRoundNoAsc(TenantContext.getTenantId(), orderId)
                .stream().map(this::toResponse).toList();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private KitchenTicketEntity require(UUID id) {
        return ticketRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Kitchen ticket not found"));
    }

    /** Every ticket takes the next round, a VOID included, so labels never repeat. */
    private int nextRound(RestaurantOrderEntity order) {
        int round = order.getRoundCount() + 1;
        order.setRoundCount(round);
        return round;
    }

    private KitchenTicketEntity newTicket(
            RestaurantOrderEntity order, KitchenTicketEntity.TicketType type, int round, String station) {
        KitchenTicketEntity ticket = KitchenTicketEntity.builder()
                .order(order)
                .ticketType(type)
                .roundNo(round)
                .label(label(order.getOrderNumber(), round, type))
                .station(station)
                .status(KitchenTicketEntity.TicketStatus.PENDING)
                .orderNumber(order.getOrderNumber())
                .orderType(order.getOrderType())
                .tableName(order.getTable() != null ? order.getTable().getName() : null)
                .covers(order.getCovers())
                .serverName(serverName(order.getServedBy()))
                .build();
        ticket.setTenantId(order.getTenantId());
        return ticket;
    }

    /** "#0042-R2" or "#0042-R3-VOID" — zero-padded so it reads the same at a glance. */
    static String label(int orderNumber, int round, KitchenTicketEntity.TicketType type) {
        String base = String.format("#%04d-R%d", orderNumber, round);
        return switch (type) {
            case VOID -> base + "-VOID";
            case MOVE -> base + "-MOVE";
            case ROUND -> base;
        };
    }

    private KitchenTicketItemEntity snapshot(RestaurantOrderItemEntity item, BigDecimal quantity, int sortOrder) {
        KitchenTicketItemEntity line = KitchenTicketItemEntity.builder()
                .orderItemId(item.getId())
                .itemName(item.getItemName())
                .quantity(quantity)
                .modifiers(modifiers(item))
                .notes(item.getNotes())
                .courseNo(item.getCourseNo())
                .sortOrder(sortOrder)
                .build();
        line.setTenantId(item.getTenantId());
        return line;
    }

    /** Add-ons, one per line: "Extra cheese", or "2 x Egg" for a double. No prices. */
    private static String modifiers(RestaurantOrderItemEntity item) {
        if (item.getToppings().isEmpty()) {
            return null;
        }
        List<String> lines = new ArrayList<>();
        for (RestaurantOrderItemToppingEntity t : item.getToppings()) {
            BigDecimal qty = t.getQuantity() == null ? BigDecimal.ONE : t.getQuantity();
            lines.add(qty.compareTo(BigDecimal.ONE) == 0
                    ? t.getToppingName()
                    : qty.stripTrailingZeros().toPlainString() + " x " + t.getToppingName());
        }
        return truncate(String.join("\n", lines), 1000);
    }

    /**
     * Product station, then its category's, then {@code KITCHEN}. Resolved at
     * fire time, so re-routing a dish affects the next round, never a sheet
     * already printed.
     */
    private Map<UUID, String> resolveStations(Collection<RestaurantOrderItemEntity> items) {
        Set<UUID> productIds = new HashSet<>();
        for (RestaurantOrderItemEntity item : items) {
            if (item.getProductId() != null) {
                productIds.add(item.getProductId());
            }
        }
        Map<UUID, String> stations = new HashMap<>();
        if (productIds.isEmpty()) {
            return stations;
        }
        UUID tenantId = TenantContext.getTenantId();
        for (ProductEntity product : productRepository.findAllById(productIds)) {
            if (!Objects.equals(product.getTenantId(), tenantId)) {
                continue;
            }
            String station = blankToNull(product.getKitchenStation());
            if (station == null && product.getCategory() != null) {
                station = blankToNull(product.getCategory().getKitchenStation());
            }
            if (station != null) {
                stations.put(product.getId(), station);
            }
        }
        return stations;
    }

    private static String stationOf(RestaurantOrderItemEntity item, Map<UUID, String> stations) {
        String station = item.getProductId() != null ? stations.get(item.getProductId()) : null;
        return station != null ? station : KitchenTicketEntity.DEFAULT_STATION;
    }

    private String serverName(UUID userId) {
        if (userId == null) {
            return null;
        }
        return userRepository.findById(userId)
                .map(u -> u.getFirstName() != null ? u.getFirstName() : u.getEmail())
                .map(name -> truncate(name, 100))
                .orElse(null);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String truncate(String s) {
        return truncate(s, 500);
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    KitchenTicketDtos.KitchenTicketResponse toResponse(KitchenTicketEntity ticket) {
        return KitchenTicketDtos.KitchenTicketResponse.builder()
                .id(ticket.getId())
                .orderId(ticket.getOrder() != null ? ticket.getOrder().getId() : null)
                .orderNumber(ticket.getOrderNumber())
                .label(ticket.getLabel())
                .ticketType(ticket.getTicketType())
                .roundNo(ticket.getRoundNo())
                .station(ticket.getStation())
                .status(ticket.getStatus())
                .orderType(ticket.getOrderType())
                .tableName(ticket.getTableName())
                .covers(ticket.getCovers())
                .serverName(ticket.getServerName())
                .printAttempts(ticket.getPrintAttempts())
                .lastError(ticket.getLastError())
                .notice(ticket.getNotice())
                .firedAt(ticket.getCreatedAt())
                .printedAt(ticket.getPrintedAt())
                .items(ticket.getItems().stream()
                        .map(i -> KitchenTicketDtos.KitchenTicketItemResponse.builder()
                                .itemName(i.getItemName())
                                .quantity(i.getQuantity())
                                .modifiers(i.getModifiers() == null ? List.of()
                                        : List.of(i.getModifiers().split("\n")))
                                .notes(i.getNotes())
                                .courseNo(i.getCourseNo())
                                .build())
                        .toList())
                .build();
    }
}
