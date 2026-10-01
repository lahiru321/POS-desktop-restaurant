package com.lumora.pos.restaurant.service;

import com.lumora.pos.auth.entity.UserEntity;
import com.lumora.pos.auth.service.ManagerPinService;
import com.lumora.pos.audit.AuditAction;
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
import com.lumora.pos.restaurant.repository.RestaurantOrderTableRepository;
import com.lumora.pos.restaurant.repository.RestaurantTableRepository;
import com.lumora.pos.restaurant.repository.ToppingRepository;
import com.lumora.pos.sales.dto.SaleRequest;
import com.lumora.pos.sales.dto.SaleResponse;
import com.lumora.pos.sales.service.SaleService;
import com.lumora.pos.tenant.TenantContext;
import com.lumora.pos.tenant.service.TenantInfoService;
import com.lumora.pos.auth.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Open tabs: seat a table, add rounds over an hour, settle at the counter.
 *
 * <p>The one decision everything else follows from: an order is its own
 * aggregate, and settling calls {@link SaleService#createSale} <em>unmodified</em>.
 * createSale stamps the cash session from the acting user's drawer, so calling it
 * at the moment of payment puts the sale on the paying cashier — which is the
 * only behaviour that keeps the Z-report honest when a tab is opened by one
 * server and paid to another.
 *
 * <p>Nothing here re-implements pricing, tax or stock. The tab carries snapshots
 * for display; the money is computed once, at settle, by the same method the
 * retail terminal calls.
 */
@Service
@RequiredArgsConstructor
public class RestaurantOrderService {

    /** The store's calendar day, matching SaleService. A UTC date would roll the
     *  order numbers over at 05:30 local, in the middle of a late shift. */
    private static final ZoneId STORE_ZONE = ZoneId.of("Asia/Colombo");

    /** V63's partial unique index on {@code table_id WHERE status = 'OPEN'} — the
     *  thing that actually makes "one table, one tab" true under a race. */
    private static final String OPEN_TABLE_CONSTRAINT = "uk_rest_order_open_table";

    /** V71: a table is joined to at most one tab. */
    private static final String JOINED_TABLE_CONSTRAINT = "uk_rest_order_tables_table";

    private final RestaurantOrderRepository orderRepository;
    private final RestaurantOrderItemRepository itemRepository;
    private final RestaurantTableRepository tableRepository;
    private final RestaurantOrderTableRepository orderTableRepository;
    private final RestaurantOrderCounterDao counterDao;
    private final ProductRepository productRepository;
    private final ToppingRepository toppingRepository;
    private final BranchRepository branchRepository;
    private final UserRepository userRepository;
    private final SaleService saleService;
    private final KitchenTicketService kitchenTicketService;
    private final TenantInfoService tenantInfoService;
    private final ManagerPinService managerPinService;
    private final AuditService auditService;

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    @Transactional(readOnly = true)
    public List<OrderDtos.OrderResponse> listOpen() {
        return orderRepository.findAllByTenantIdAndStatusOrderByOpenedAtDesc(
                        TenantContext.getTenantId(), RestaurantOrderEntity.OrderStatus.OPEN)
                .stream().map(this::toResponse).toList();
    }

    @Transactional(readOnly = true)
    public OrderDtos.OrderResponse get(UUID id) {
        return toResponse(require(id));
    }

    // ------------------------------------------------------------------
    // Opening a tab
    // ------------------------------------------------------------------

    @Transactional
    public OrderDtos.OrderResponse open(OrderDtos.OpenOrderRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        UUID currentUserId = currentUserId();
        BranchEntity branch = resolveBranch(request.getBranchId(), tenantId, currentUserId);

        RestaurantOrderEntity.OrderType type = request.getOrderType() != null
                ? request.getOrderType()
                : RestaurantOrderEntity.OrderType.DINE_IN;

        RestaurantTableEntity table = resolveTable(type, request.getTableId(), tenantId);

        LocalDate businessDate = LocalDate.now(STORE_ZONE);
        int orderNumber = counterDao.nextOrderNumber(tenantId, branch.getId(), businessDate);

        RestaurantOrderEntity order = RestaurantOrderEntity.builder()
                .branch(branch)
                .orderNumber(orderNumber)
                .businessDate(businessDate)
                .orderType(type)
                .table(table)
                .customerId(request.getCustomerId())
                .status(RestaurantOrderEntity.OrderStatus.OPEN)
                .covers(request.getCovers() != null ? request.getCovers() : 0)
                .openedBy(currentUserId)
                .servedBy(request.getServedBy() != null ? request.getServedBy() : currentUserId)
                .openedAt(LocalDateTime.now())
                .build();
        order.setTenantId(tenantId);

        if (request.getItems() != null) {
            for (OrderDtos.OrderItemRequest line : request.getItems()) {
                order.addItem(buildItem(line, tenantId, order.getItems().size()));
            }
        }

        RestaurantOrderEntity saved;
        try {
            // saveAndFlush, not save: resolveTable's check is a read-then-write and
            // the real guarantee is uk_rest_order_open_table. The INSERT has to
            // reach the database inside this try block — deferred to commit, the
            // loser of a genuine race escapes the handler below and surfaces as a
            // generic 500 instead of "that table is taken".
            saved = orderRepository.saveAndFlush(order);
        } catch (DataIntegrityViolationException ex) {
            if (table != null && mentionsConstraint(ex, OPEN_TABLE_CONSTRAINT)) {
                throw new BusinessException(tableBusy(table));
            }
            // Any other integrity violation is somebody else's bug; do not
            // disguise it as a busy table.
            throw ex;
        }
        if (table != null) {
            table.setStatus(RestaurantTableEntity.TableStatus.OCCUPIED);
        }

        OrderDtos.OrderResponse response = toResponse(saved);
        auditService.logCreate("RESTAURANT_ORDER", saved.getId(), Map.of(
                "orderNumber", saved.getOrderNumber(),
                "type", saved.getOrderType().name(),
                "table", table != null ? table.getName() : "TAKEAWAY"));
        return response;
    }

    // ------------------------------------------------------------------
    // Rounds
    // ------------------------------------------------------------------

    @Transactional
    public OrderDtos.OrderResponse addItems(UUID orderId, OrderDtos.AddItemsRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantOrderEntity order = requireOpen(orderId);

        for (OrderDtos.OrderItemRequest line : request.getItems()) {
            order.addItem(buildItem(line, tenantId, order.getItems().size()));
        }

        RestaurantOrderEntity saved = orderRepository.save(order);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", orderId,
                null, Map.of("addedLines", request.getItems().size()));
        return toResponse(saved);
    }

    /**
     * Quantity and notes only.
     *
     * <p>Reducing below what the kitchen was already told to cook is refused:
     * that is a void, and a void has to reach the kitchen as a void ticket
     * rather than quietly shrinking a number here.
     */
    @Transactional
    public OrderDtos.OrderResponse updateItem(UUID orderId, UUID itemId, OrderDtos.UpdateItemRequest request) {
        RestaurantOrderEntity order = requireOpen(orderId);
        RestaurantOrderItemEntity item = requireItem(order, itemId);

        if (request.getQuantity() != null) {
            BigDecimal quantity = request.getQuantity();
            // Fired and voided units are both already accounted for — one is in the
            // kitchen, the other written off — so neither can be edited away.
            BigDecimal committed = item.getFiredQuantity().add(item.getVoidedQuantity());
            if (quantity.compareTo(committed) < 0) {
                throw new BusinessException(item.getFiredQuantity().signum() > 0
                        ? "The kitchen already has " + item.getFiredQuantity().stripTrailingZeros().toPlainString()
                                + " of this. Void it instead of reducing the quantity."
                        : "Cannot go below the quantity already voided on this line");
            }
            item.setQuantity(quantity);
        }
        if (request.getNotes() != null) {
            item.setNotes(request.getNotes().isBlank() ? null : request.getNotes().trim());
        }

        RestaurantOrderEntity saved = orderRepository.save(order);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER_ITEM", itemId, null,
                Map.of("quantity", item.getQuantity().toPlainString()));
        return toResponse(saved);
    }

    /**
     * Voids some or all of a line, telling the kitchen only about what it had.
     *
     * <p>Voided quantity is counted, never subtracted from {@code quantity}. The
     * void is taken from the unsent units first — there is nothing to un-cook, so
     * no ticket — and only the remainder, which the kitchen was already told to
     * cook, becomes a VOID ticket and comes back off {@code firedQuantity}. A cook
     * who has already started needs telling; a silent delete tells no one.
     */
    @Transactional
    public OrderDtos.OrderKitchenResponse voidItem(UUID orderId, UUID itemId, OrderDtos.VoidItemRequest request) {
        RestaurantOrderEntity order = requireOpenForUpdate(orderId);
        RestaurantOrderItemEntity item = requireItem(order, itemId);

        BigDecimal remaining = item.billableQuantity();
        if (remaining.signum() <= 0) {
            throw new BusinessException("This line is already fully voided");
        }
        BigDecimal amount = request != null && request.getQuantity() != null
                ? request.getQuantity()
                : remaining;
        if (amount.compareTo(remaining) > 0) {
            throw new BusinessException("Cannot void " + amount.toPlainString()
                    + " — only " + remaining.toPlainString() + " left on this line");
        }
        String reason = request != null && request.getReason() != null ? request.getReason() : "";

        BigDecimal fromUnsent = amount.min(item.pendingQuantity());
        BigDecimal firedPortion = amount.subtract(fromUnsent);
        UUID approvedBy = requireApprovalForFiredVoid(firedPortion, request);

        item.setVoidedQuantity(item.getVoidedQuantity().add(amount));
        item.setFiredQuantity(item.getFiredQuantity().subtract(firedPortion));

        Map<RestaurantOrderItemEntity, BigDecimal> portions = new LinkedHashMap<>();
        portions.put(item, firedPortion);
        List<KitchenTicketEntity> tickets = kitchenTicketService.voidPortions(order, portions, reason);

        RestaurantOrderEntity saved = orderRepository.save(order);
        Map<String, Object> audit = new LinkedHashMap<>();
        audit.put("voided", amount.toPlainString());
        audit.put("firedPortion", firedPortion.toPlainString());
        audit.put("reason", reason);
        if (approvedBy != null) {
            audit.put("approvedBy", approvedBy);
        }
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER_ITEM", itemId, null, audit);
        return withTickets(saved, tickets);
    }

    /**
     * When the tenant asks for it, a cashier cannot take back food the kitchen
     * already has without a manager's PIN. Unsent units never need one — nothing
     * was cooked — and a manager or admin approves their own void.
     *
     * @return the approving manager's id when a PIN was used, else null
     */
    private UUID requireApprovalForFiredVoid(BigDecimal firedPortion, OrderDtos.VoidItemRequest request) {
        if (firedPortion.signum() <= 0
                || !tenantInfoService.restaurantVoidRequiresPin(TenantContext.getTenantId())
                || managerPinService.currentUserIsManager()) {
            return null;
        }
        String pin = request != null ? request.getManagerPin() : null;
        if (pin == null || pin.isBlank()) {
            throw new BusinessException("Manager PIN is required to void food the kitchen already has");
        }
        return managerPinService.findApprover(TenantContext.getTenantId(), pin)
                .map(UserEntity::getId)
                .orElseThrow(() -> new BusinessException("Invalid manager PIN"));
    }

    // ------------------------------------------------------------------
    // Kitchen
    // ------------------------------------------------------------------

    /**
     * Sends everything not yet fired as the next round.
     *
     * <p>Locked, so two servers pressing Send on the same table a moment apart
     * queue: the second sees nothing left to send instead of printing the same
     * dishes twice.
     */
    @Transactional
    public OrderDtos.OrderKitchenResponse fire(UUID orderId) {
        RestaurantOrderEntity order = requireOpenForUpdate(orderId);
        List<KitchenTicketEntity> tickets = kitchenTicketService.fireRound(order);
        RestaurantOrderEntity saved = orderRepository.save(order);
        return withTickets(saved, tickets);
    }

    // ------------------------------------------------------------------
    // Moving and merging tabs
    // ------------------------------------------------------------------

    /**
     * Carries a dine-in tab to another, free table.
     *
     * <p>The target must be free: two parties on one table is a merge, and the
     * caller is told so rather than having it guessed. {@code uk_rest_order_open_table}
     * is the real guarantee under a race, exactly as when opening a tab.
     *
     * <p>Only the tab's own table moves; tables joined to it stay joined.
     *
     * <p>If the kitchen already has food for this tab, a MOVE ticket goes out so
     * the runner carries it to the new table, not the old one.
     */
    @Transactional
    public OrderDtos.OrderKitchenResponse move(UUID orderId, OrderDtos.MoveOrderRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantOrderEntity order = requireOpenForUpdate(orderId);
        if (order.getOrderType() != RestaurantOrderEntity.OrderType.DINE_IN) {
            throw new BusinessException("A takeaway has no table to move");
        }
        RestaurantTableEntity target = tableRepository.findByIdAndTenantIdForUpdate(request.getTableId(), tenantId)
                .orElseThrow(() -> new BusinessException("Table not found"));
        RestaurantTableEntity from = order.getTable();
        if (from != null && from.getId().equals(target.getId())) {
            throw new BusinessException("This tab is already on " + target.getName());
        }
        if (isJoined(order, target)) {
            throw new BusinessException(target.getName() + " is already part of this tab");
        }
        requireTableFree(target, tenantId, ". Merge the two tabs instead.");

        order.setTable(target);
        try {
            // Flushed inside the try for the same reason open() does: the index,
            // not the check above, is what settles a genuine race.
            orderRepository.saveAndFlush(order);
        } catch (DataIntegrityViolationException ex) {
            if (mentionsConstraint(ex, OPEN_TABLE_CONSTRAINT)) {
                throw new BusinessException(tableBusy(target));
            }
            throw ex;
        }
        if (from != null) {
            from.setStatus(RestaurantTableEntity.TableStatus.AVAILABLE);
        }
        target.setStatus(RestaurantTableEntity.TableStatus.OCCUPIED);

        String fromName = from != null ? from.getName() : "?";
        List<KitchenTicketEntity> tickets = kitchenTicketService.moveNotice(order, "MOVED FROM " + fromName);
        RestaurantOrderEntity saved = orderRepository.save(order);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", orderId, Map.of("table", fromName),
                Map.of("table", target.getName()));
        return withTickets(saved, tickets);
    }

    /**
     * Folds another open tab into this one: the party at T2 joins their friends
     * at T7, and the two bills become one.
     *
     * <p>The lines move as they are — same rows, same fired and voided counts —
     * so nothing is sent to the kitchen twice. The absorbed order becomes MERGED;
     * its own kitchen tickets stay with it as the record of what was sent under
     * that number. If the kitchen was cooking for it, a MOVE ticket on this order
     * tells the runner where that food now goes.
     *
     * <p>Its tables do not empty when the bills combine — the people are still
     * sitting there — so they become tables joined to this tab and stay
     * occupied until it is settled. Only a parked takeaway, which has no table to
     * join them to, frees them.
     */
    @Transactional
    public OrderDtos.OrderKitchenResponse merge(UUID targetId, OrderDtos.MergeOrderRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        UUID sourceId = request.getSourceOrderId();
        if (targetId.equals(sourceId)) {
            throw new BusinessException("A tab cannot be merged into itself");
        }

        // Always lock the lower id first, so two tills merging the same pair from
        // opposite ends queue instead of deadlocking.
        boolean targetFirst = targetId.compareTo(sourceId) < 0;
        RestaurantOrderEntity first = requireOpenForUpdate(targetFirst ? targetId : sourceId);
        RestaurantOrderEntity second = requireOpenForUpdate(targetFirst ? sourceId : targetId);
        RestaurantOrderEntity target = targetFirst ? first : second;
        RestaurantOrderEntity source = targetFirst ? second : first;

        if (!target.getBranch().getId().equals(source.getBranch().getId())) {
            // A sale has to match its drawer's branch; one bill cannot straddle two.
            throw new BusinessException("Those tabs belong to different branches");
        }

        boolean sourceCooking = source.getItems().stream().anyMatch(i -> i.getFiredQuantity().signum() > 0);
        String sourceWhere = source.getTable() != null ? source.tableLabel() : "takeaway";
        int sourceNumber = source.getOrderNumber();
        boolean keepTables = target.getOrderType() == RestaurantOrderEntity.OrderType.DINE_IN
                && target.getTable() != null;
        List<UUID> sourceTables = new ArrayList<>();
        if (source.getTable() != null) {
            sourceTables.add(source.getTable().getId());
        }
        source.getJoinedTables().forEach(j -> sourceTables.add(j.getTable().getId()));

        target.setCovers(target.getCovers() + source.getCovers());
        if (target.getCustomerId() == null) {
            target.setCustomerId(source.getCustomerId());
        }
        source.setStatus(RestaurantOrderEntity.OrderStatus.MERGED);
        if (keepTables) {
            // The rows go now and come back on the target below. reassignLines
            // flushes these deletes first, so V71's UNIQUE (table_id) never sees
            // a table on both tabs at once.
            source.getJoinedTables().clear();
        } else {
            freeTable(source);
        }

        // Flushes the changes above, re-parents the rows, then clears the context.
        int moved = itemRepository.reassignLines(source, target, tenantId);

        RestaurantOrderEntity merged = require(targetId);
        if (keepTables) {
            // Re-read: the clear above detached every table loaded before it.
            for (UUID tableId : sourceTables) {
                tableRepository.findByIdAndTenantId(tableId, tenantId)
                        .ifPresent(t -> orderTableRepository.save(merged.joinTable(t)));
            }
        }
        List<KitchenTicketEntity> tickets = sourceCooking
                ? kitchenTicketService.moveNotice(merged, "ORDER " + sourceNumber + " FROM " + sourceWhere + " JOINS")
                : List.of();
        RestaurantOrderEntity saved = orderRepository.save(merged);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", targetId, null, Map.of(
                "mergedFrom", sourceId, "lines", moved));
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", sourceId, null, Map.of(
                "status", "MERGED", "into", targetId));
        return withTickets(saved, tickets);
    }

    /**
     * Seats the same party at one more table: T1 and T2 pushed together, one bill.
     *
     * <p>The table must be free — a table with its own tab is a merge, and the
     * caller is told so. Its row lock queues this against anyone seating it at
     * the same moment, and V71's unique key is the backstop.
     */
    @Transactional
    public OrderDtos.OrderKitchenResponse joinTable(UUID orderId, OrderDtos.JoinTableRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantOrderEntity order = requireOpenForUpdate(orderId);
        if (order.getOrderType() != RestaurantOrderEntity.OrderType.DINE_IN || order.getTable() == null) {
            throw new BusinessException("Only a dine-in tab on a table can take another table");
        }
        RestaurantTableEntity table = tableRepository.findByIdAndTenantIdForUpdate(request.getTableId(), tenantId)
                .orElseThrow(() -> new BusinessException("Table not found"));
        if (order.getTable().getId().equals(table.getId()) || isJoined(order, table)) {
            throw new BusinessException(table.getName() + " is already part of this tab");
        }
        requireTableFree(table, tenantId, ". Merge the two tabs instead.");

        RestaurantOrderTableEntity row = order.joinTable(table);
        try {
            // Flushed inside the try for the same reason open() does: the unique
            // key, not the check above, is what settles a genuine race.
            orderTableRepository.saveAndFlush(row);
        } catch (DataIntegrityViolationException ex) {
            if (mentionsConstraint(ex, JOINED_TABLE_CONSTRAINT)) {
                throw new BusinessException(tableBusy(table));
            }
            throw ex;
        }
        table.setStatus(RestaurantTableEntity.TableStatus.OCCUPIED);

        List<KitchenTicketEntity> tickets = kitchenTicketService.moveNotice(order,
                table.getName() + " JOINS " + order.getTable().getName());
        RestaurantOrderEntity saved = orderRepository.save(order);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", orderId, null,
                Map.of("joinedTable", table.getName()));
        return withTickets(saved, tickets);
    }

    /** Lets a joined table go — part of the party left — and frees it. The tab's
     *  own table is not released this way; moving the tab is how that changes. */
    @Transactional
    public OrderDtos.OrderResponse releaseTable(UUID orderId, UUID tableId) {
        RestaurantOrderEntity order = requireOpenForUpdate(orderId);
        if (order.getTable() != null && order.getTable().getId().equals(tableId)) {
            throw new BusinessException(order.getTable().getName()
                    + " is this tab's own table. Move the tab to change it.");
        }
        RestaurantOrderTableEntity row = order.getJoinedTables().stream()
                .filter(j -> j.getTable().getId().equals(tableId))
                .findFirst()
                .orElseThrow(() -> new BusinessException("That table is not part of this tab"));

        order.getJoinedTables().remove(row);
        row.getTable().setStatus(RestaurantTableEntity.TableStatus.AVAILABLE);
        RestaurantOrderEntity saved = orderRepository.save(order);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", orderId, null,
                Map.of("releasedTable", row.getTable().getName()));
        return toResponse(saved);
    }

    // ------------------------------------------------------------------
    // Settle — the money path, reached exactly once
    // ------------------------------------------------------------------

    @Transactional
    public OrderDtos.SettleResponse settle(UUID orderId, OrderDtos.SettleRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantOrderEntity order = orderRepository.findByIdAndTenantIdForUpdate(orderId, tenantId)
                .orElseThrow(() -> new BusinessException("Order not found"));
        if (order.getStatus() != RestaurantOrderEntity.OrderStatus.OPEN) {
            throw new BusinessException("This order is already " + order.getStatus());
        }

        List<RestaurantOrderItemEntity> billable = order.getItems().stream()
                .filter(i -> i.billableQuantity().signum() > 0)
                .toList();
        if (billable.isEmpty()) {
            // SaleRequest.items is @NotEmpty, and a zero-line sale is meaningless anyway.
            throw new BusinessException("Nothing left to bill — void the order instead");
        }

        // Dine-in bills carry the service charge; takeaway never does. The rate is
        // the tenant's, never the till's; the till can only take it off one bill.
        boolean dineIn = order.getOrderType() == RestaurantOrderEntity.OrderType.DINE_IN;
        boolean waived = dineIn && Boolean.TRUE.equals(request.getWaiveServiceCharge());
        int serviceRate = dineIn && !waived ? tenantInfoService.serviceChargeRate(tenantId) : 0;

        SaleResponse sale = saleService.createSale(SaleRequest.builder()
                .customerId(order.getCustomerId())
                .branchId(order.getBranch().getId())
                .paymentMethod(request.getPaymentMethod())
                .cashTendered(request.getCashTendered())
                .pointsToRedeem(request.getPointsToRedeem())
                .serviceChargeRate(serviceRate > 0 ? BigDecimal.valueOf(serviceRate) : null)
                .serviceChargeWaived(waived)
                .items(billable.stream().map(this::toSaleLine).toList())
                .build());

        order.setSaleId(sale.getId());
        order.setStatus(RestaurantOrderEntity.OrderStatus.SETTLED);
        order.setSettledAt(LocalDateTime.now());
        // Named before the joined tables are let go, so "T1+T2 paid" says where.
        String label = label(order);
        freeTable(order);

        // Takeaway pays, then fires: whatever the kitchen has not been told about
        // goes now, in the same transaction as the sale, so a paid order can never
        // be missing its ticket. Dine-in never fires here — its rounds were sent
        // while the guests were eating, and a leftover is the cashier's call.
        boolean takeaway = order.getOrderType() == RestaurantOrderEntity.OrderType.TAKEAWAY;
        List<KitchenTicketEntity> tickets = takeaway
                && order.getItems().stream().anyMatch(i -> i.pendingQuantity().signum() > 0)
                ? kitchenTicketService.fireRound(order)
                : List.of();
        orderRepository.save(order);

        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", orderId, null, Map.of(
                "status", "SETTLED", "saleId", sale.getId()));

        return OrderDtos.SettleResponse.builder()
                .sale(sale)
                .label(label)
                .repricedLines(repricedLines(billable, sale))
                .tickets(tickets.stream().map(kitchenTicketService::toResponse).toList())
                .build();
    }

    /**
     * Pays for part of a tab: "I'll get my kottu and the juice."
     *
     * <p>The chosen quantities leave the tab as an order of their own — no table,
     * its own number, {@code splitFromId} pointing back — which is then settled
     * through the same {@link #settle} path as any tab, so the payer gets a real
     * sale on the drawer of whoever took the money. The rest stays open.
     *
     * <p>Each moved unit takes its share of the line with it: fired units first
     * (what is being paid for has usually been eaten), and the line discount in
     * proportion, so the tab and the split together bill exactly what the tab
     * would have alone. All of it, split and payment, is one transaction — a
     * refused payment puts every unit back.
     */
    @Transactional
    public OrderDtos.SettleResponse splitSettle(UUID orderId, OrderDtos.SplitSettleRequest request) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantOrderEntity tab = requireOpenForUpdate(orderId);

        Map<RestaurantOrderItemEntity, BigDecimal> taking = new LinkedHashMap<>();
        for (OrderDtos.SplitLine line : request.getLines()) {
            taking.merge(requireItem(tab, line.getItemId()), line.getQuantity(), BigDecimal::add);
        }
        BigDecimal taken = BigDecimal.ZERO;
        for (Map.Entry<RestaurantOrderItemEntity, BigDecimal> e : taking.entrySet()) {
            BigDecimal left = e.getKey().billableQuantity();
            if (e.getValue().compareTo(left) > 0) {
                throw new BusinessException("Only " + left.stripTrailingZeros().toPlainString() + " of "
                        + e.getKey().getItemName() + " left to pay for");
            }
            taken = taken.add(e.getValue());
        }
        BigDecimal wholeTab = tab.getItems().stream()
                .map(RestaurantOrderItemEntity::billableQuantity)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (taken.compareTo(wholeTab) >= 0) {
            throw new BusinessException("That is the whole tab — settle it instead of splitting");
        }

        LocalDate businessDate = LocalDate.now(STORE_ZONE);
        RestaurantOrderEntity split = RestaurantOrderEntity.builder()
                .branch(tab.getBranch())
                .orderNumber(counterDao.nextOrderNumber(tenantId, tab.getBranch().getId(), businessDate))
                .businessDate(businessDate)
                .orderType(tab.getOrderType())
                .customerId(tab.getCustomerId())
                .status(RestaurantOrderEntity.OrderStatus.OPEN)
                .openedBy(currentUserId())
                .servedBy(tab.getServedBy())
                .openedAt(LocalDateTime.now())
                .splitFromId(tab.getId())
                .build();
        split.setTenantId(tenantId);

        int sortOrder = 0;
        for (Map.Entry<RestaurantOrderItemEntity, BigDecimal> e : taking.entrySet()) {
            RestaurantOrderItemEntity item = e.getKey();
            BigDecimal qty = e.getValue();
            BigDecimal ordered = item.getQuantity();
            BigDecimal firedMoved = qty.min(item.getFiredQuantity());
            BigDecimal discountMoved = item.getDiscountAmount().signum() == 0 ? BigDecimal.ZERO
                    : item.getDiscountAmount().multiply(qty).divide(ordered, 2, RoundingMode.HALF_UP);

            RestaurantOrderItemEntity copy = RestaurantOrderItemEntity.builder()
                    .productId(item.getProductId())
                    .itemName(item.getItemName())
                    .quantity(qty)
                    .firedQuantity(firedMoved)
                    .voidedQuantity(BigDecimal.ZERO)
                    .unitPriceSnapshot(item.getUnitPriceSnapshot())
                    .discountAmount(discountMoved)
                    .notes(item.getNotes())
                    .courseNo(item.getCourseNo())
                    .sortOrder(sortOrder++)
                    .build();
            copy.setTenantId(tenantId);
            int toppingOrder = 0;
            for (RestaurantOrderItemToppingEntity t : item.getToppings()) {
                RestaurantOrderItemToppingEntity row = RestaurantOrderItemToppingEntity.builder()
                        .toppingId(t.getToppingId())
                        .toppingName(t.getToppingName())
                        .quantity(t.getQuantity())
                        .unitPrice(t.getUnitPrice())
                        .priceMode(t.getPriceMode())
                        .sortOrder(toppingOrder++)
                        .build();
                row.setTenantId(tenantId);
                copy.addTopping(row);
            }
            split.addItem(copy);

            BigDecimal remaining = ordered.subtract(qty);
            if (remaining.signum() == 0) {
                // The whole line went, with nothing voided left behind to record.
                tab.getItems().remove(item);
            } else {
                item.setQuantity(remaining);
                item.setFiredQuantity(item.getFiredQuantity().subtract(firedMoved));
                item.setDiscountAmount(item.getDiscountAmount().subtract(discountMoved));
            }
        }

        orderRepository.save(tab);
        RestaurantOrderEntity savedSplit = orderRepository.saveAndFlush(split);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", tab.getId(), null, Map.of(
                "splitInto", savedSplit.getId(), "units", taken.toPlainString()));

        return settle(savedSplit.getId(), OrderDtos.SettleRequest.builder()
                .paymentMethod(request.getPaymentMethod())
                .cashTendered(request.getCashTendered())
                .pointsToRedeem(request.getPointsToRedeem())
                .waiveServiceCharge(request.getWaiveServiceCharge())
                .build());
    }

    /**
     * A takeaway paid at the counter, as one transaction: open the order, settle
     * it through the unmodified {@code createSale}, fire the kitchen. Any refusal
     * rolls all three back, order number included.
     */
    @Transactional
    public OrderDtos.SettleResponse takeaway(OrderDtos.TakeawayRequest request) {
        OrderDtos.OrderResponse opened = open(OrderDtos.OpenOrderRequest.builder()
                .orderType(RestaurantOrderEntity.OrderType.TAKEAWAY)
                .customerId(request.getCustomerId())
                .branchId(request.getBranchId())
                .items(request.getItems())
                .build());
        return settle(opened.getId(), OrderDtos.SettleRequest.builder()
                .paymentMethod(request.getPaymentMethod())
                .cashTendered(request.getCashTendered())
                .pointsToRedeem(request.getPointsToRedeem())
                .build());
    }

    /**
     * Writes off the whole tab and frees the table. Anything the kitchen was
     * already cooking goes out on one VOID ticket; unsent lines need no paper.
     */
    @Transactional
    public OrderDtos.OrderKitchenResponse voidOrder(UUID orderId) {
        RestaurantOrderEntity order = requireOpenForUpdate(orderId);

        Map<RestaurantOrderItemEntity, BigDecimal> firedPortions = new LinkedHashMap<>();
        for (RestaurantOrderItemEntity item : order.getItems()) {
            firedPortions.put(item, item.getFiredQuantity());
            item.setVoidedQuantity(item.getQuantity());
            item.setFiredQuantity(BigDecimal.ZERO);
        }
        List<KitchenTicketEntity> tickets = kitchenTicketService.voidPortions(order, firedPortions, "Tab voided");

        order.setStatus(RestaurantOrderEntity.OrderStatus.VOIDED);
        freeTable(order);
        RestaurantOrderEntity saved = orderRepository.save(order);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", orderId, null, Map.of("status", "VOIDED"));
        return withTickets(saved, tickets);
    }

    // ------------------------------------------------------------------
    // Building lines
    // ------------------------------------------------------------------

    private RestaurantOrderItemEntity buildItem(OrderDtos.OrderItemRequest request, UUID tenantId, int sortOrder) {
        RestaurantOrderItemEntity item = RestaurantOrderItemEntity.builder()
                .quantity(request.getQuantity())
                .firedQuantity(BigDecimal.ZERO)
                .voidedQuantity(BigDecimal.ZERO)
                .discountAmount(request.getDiscountAmount() != null ? request.getDiscountAmount() : BigDecimal.ZERO)
                .notes(request.getNotes() != null && !request.getNotes().isBlank()
                        ? request.getNotes().trim() : null)
                .sortOrder(sortOrder)
                .build();
        item.setTenantId(tenantId);

        if (request.getProductId() != null) {
            ProductEntity product = productRepository.findByIdAndTenantId(request.getProductId(), tenantId)
                    .orElseThrow(() -> new BusinessException("Product not found: " + request.getProductId()));
            item.setProductId(product.getId());
            item.setItemName(product.getName());
            // Snapshot only. createSale re-reads base_price at settle and ignores
            // whatever a client sent, so this never becomes an authored price.
            item.setUnitPriceSnapshot(product.getBasePrice() != null ? product.getBasePrice() : BigDecimal.ZERO);
        } else {
            item.setItemName(request.getItemName().trim());
            // A custom line has no catalogue entry to check against, so a typed
            // price is all there is — exactly as V49 custom lines already work.
            item.setUnitPriceSnapshot(request.getUnitPrice() != null ? request.getUnitPrice() : BigDecimal.ZERO);
        }

        if (request.getToppings() != null) {
            int toppingOrder = 0;
            for (OrderDtos.OrderItemToppingRequest t : request.getToppings()) {
                item.addTopping(buildTopping(t, tenantId, toppingOrder++));
            }
        }
        return item;
    }

    private RestaurantOrderItemToppingEntity buildTopping(
            OrderDtos.OrderItemToppingRequest request, UUID tenantId, int sortOrder) {
        ToppingEntity topping = toppingRepository.findByIdAndTenantId(request.getToppingId(), tenantId)
                .orElseThrow(() -> new BusinessException("Topping not found: " + request.getToppingId()));

        // Every rule below is SaleService's, condition and wording both. createSale
        // refuses the same input at settle, and a refusal there rolls back the whole
        // settle and leaves the table OPEN with a line nobody can bill — so the tab
        // has to refuse it at ring-up, while the cashier can still change it.
        if (!topping.isActive()) {
            throw new BusinessException("Topping " + topping.getName() + " is no longer available");
        }

        // The narrow price exemption, keyed on a server-side column and nothing else.
        BigDecimal price;
        if (topping.getPriceMode() == ToppingEntity.PriceMode.PROMPT) {
            BigDecimal typed = request.getUnitPrice();
            if (typed == null) {
                throw new BusinessException("A price is required for " + topping.getName());
            }
            if (typed.signum() < 0) {
                throw new BusinessException(
                        "Price for " + topping.getName() + " cannot be negative");
            }
            // Refused, never clamped: silently rewriting what the cashier typed
            // bills a number nobody quoted, and retail throws on this same rule.
            if (topping.getMaxPrice() != null && typed.compareTo(topping.getMaxPrice()) > 0) {
                throw new BusinessException("Price for " + topping.getName()
                        + " exceeds the allowed maximum of " + topping.getMaxPrice());
            }
            price = typed.setScale(2, RoundingMode.HALF_UP);
        } else {
            price = topping.getDefaultPrice() != null ? topping.getDefaultPrice() : BigDecimal.ZERO;
        }

        RestaurantOrderItemToppingEntity row = RestaurantOrderItemToppingEntity.builder()
                .toppingId(topping.getId())
                .toppingName(topping.getName())
                .quantity(request.getQuantity() != null ? request.getQuantity() : BigDecimal.ONE)
                .unitPrice(price)
                .priceMode(topping.getPriceMode())
                .sortOrder(sortOrder)
                .build();
        row.setTenantId(tenantId);
        return row;
    }

    private SaleRequest.SaleItemRequest toSaleLine(RestaurantOrderItemEntity item) {
        return SaleRequest.SaleItemRequest.builder()
                .productId(item.getProductId())
                .itemName(item.getProductId() == null ? item.getItemName() : null)
                .quantity(item.billableQuantity())
                .unitPrice(item.getUnitPriceSnapshot())
                .discountAmount(billableDiscount(item))
                .notes(item.getNotes())
                .toppings(item.getToppings().stream()
                        .filter(t -> t.getToppingId() != null)
                        .map(t -> SaleRequest.SaleItemToppingRequest.builder()
                                .toppingId(t.getToppingId())
                                .quantity(t.getQuantity())
                                .unitPrice(t.getUnitPrice())
                                .build())
                        .toList())
                .build();
    }

    /**
     * The line's discount, scaled to what is actually being billed.
     *
     * <p>A void reduces the billable quantity but leaves {@code discountAmount}
     * alone — it was agreed against the whole line. Sending the full figure would
     * discount a smaller sale by the larger amount, and can trip createSale's
     * "discount exceeds line subtotal" guard outright. Rounded HALF_UP at scale 2,
     * the same per-row rounding {@code applyLineMath} uses on the other side.
     */
    private BigDecimal billableDiscount(RestaurantOrderItemEntity item) {
        BigDecimal discount = item.getDiscountAmount();
        if (discount == null || discount.signum() == 0) {
            return BigDecimal.ZERO;
        }
        BigDecimal ordered = item.getQuantity();
        BigDecimal billable = item.billableQuantity();
        // Nothing voided, or a quantity that cannot be divided by: leave it be.
        if (ordered == null || ordered.signum() <= 0 || billable.compareTo(ordered) >= 0) {
            return discount;
        }
        return discount.multiply(billable).divide(ordered, 2, RoundingMode.HALF_UP);
    }

    /**
     * Lines whose catalogue price moved between ordering and paying.
     *
     * <p>Covers the dish and its FIXED add-ons, because createSale re-reads
     * {@code toppings.default_price} at settle exactly as it re-reads
     * {@code products.base_price} — so an add-on's price can move mid-meal too,
     * and an unreported move is the same surprise on the same bill. A PROMPT
     * add-on is cashier-authored, not catalogue-priced, so it never re-prices.
     *
     * <p>The two lists are built from the same billable list in the same order,
     * so they line up index for index; a size mismatch means something changed
     * the shape of the sale and the comparison is skipped rather than guessed at.
     */
    private List<OrderDtos.RepricedLine> repricedLines(
            List<RestaurantOrderItemEntity> billable, SaleResponse sale) {
        List<SaleResponse.SaleItemResponse> lines = sale.getItems() == null
                ? List.of() : sale.getItems();
        List<SaleResponse.SaleItemResponse> parents = lines.stream()
                .filter(i -> i.getParentItemId() == null && i.getToppingId() == null)
                .toList();
        if (parents.size() != billable.size()) {
            return List.of();
        }

        List<OrderDtos.RepricedLine> moved = new ArrayList<>();
        for (int i = 0; i < parents.size(); i++) {
            RestaurantOrderItemEntity ordered = billable.get(i);
            SaleResponse.SaleItemResponse billed = parents.get(i);
            if (billed.getUnitPrice() != null && ordered.getUnitPriceSnapshot() != null
                    && billed.getUnitPrice().compareTo(ordered.getUnitPriceSnapshot()) != 0) {
                moved.add(OrderDtos.RepricedLine.builder()
                        .itemName(ordered.getItemName())
                        .orderedPrice(ordered.getUnitPriceSnapshot())
                        .billedPrice(billed.getUnitPrice())
                        .build());
            }
            moved.addAll(repricedToppings(ordered, billed.getId(), lines));
        }
        return moved;
    }

    /**
     * FIXED add-ons on one line whose catalogue price moved, by the same rule.
     *
     * <p>Matched positionally: {@code toSaleLine} emits the toppings in list
     * order and createSale appends one child per request in that order, so index
     * {@code i} on each side is the same add-on — confirmed against
     * {@code toppingId} before anything is reported.
     */
    private List<OrderDtos.RepricedLine> repricedToppings(
            RestaurantOrderItemEntity ordered, UUID parentSaleItemId,
            List<SaleResponse.SaleItemResponse> lines) {
        if (parentSaleItemId == null) {
            return List.of();
        }
        List<RestaurantOrderItemToppingEntity> orderedToppings = ordered.getToppings().stream()
                .filter(t -> t.getToppingId() != null)
                .toList();
        List<SaleResponse.SaleItemResponse> billedToppings = lines.stream()
                .filter(i -> parentSaleItemId.equals(i.getParentItemId()))
                .toList();
        if (orderedToppings.isEmpty() || billedToppings.size() != orderedToppings.size()) {
            return List.of();
        }

        List<OrderDtos.RepricedLine> moved = new ArrayList<>();
        for (int i = 0; i < orderedToppings.size(); i++) {
            RestaurantOrderItemToppingEntity was = orderedToppings.get(i);
            SaleResponse.SaleItemResponse billed = billedToppings.get(i);
            if (was.getPriceMode() == ToppingEntity.PriceMode.PROMPT) {
                continue;
            }
            if (was.getUnitPrice() == null || billed.getUnitPrice() == null
                    || !was.getToppingId().equals(billed.getToppingId())) {
                continue;
            }
            if (billed.getUnitPrice().compareTo(was.getUnitPrice()) != 0) {
                moved.add(OrderDtos.RepricedLine.builder()
                        .itemName(ordered.getItemName())
                        .toppingName(was.getToppingName())
                        .orderedPrice(was.getUnitPrice())
                        .billedPrice(billed.getUnitPrice())
                        .build());
            }
        }
        return moved;
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private RestaurantOrderEntity require(UUID id) {
        return orderRepository.findByIdAndTenantId(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Order not found"));
    }

    private RestaurantOrderEntity requireOpen(UUID id) {
        RestaurantOrderEntity order = require(id);
        if (order.getStatus() != RestaurantOrderEntity.OrderStatus.OPEN) {
            throw new BusinessException("This order is already " + order.getStatus());
        }
        return order;
    }

    /** Row-locked, for anything that may print: see {@link #fire}. */
    private RestaurantOrderEntity requireOpenForUpdate(UUID id) {
        RestaurantOrderEntity order = orderRepository.findByIdAndTenantIdForUpdate(id, TenantContext.getTenantId())
                .orElseThrow(() -> new BusinessException("Order not found"));
        if (order.getStatus() != RestaurantOrderEntity.OrderStatus.OPEN) {
            throw new BusinessException("This order is already " + order.getStatus());
        }
        return order;
    }

    private OrderDtos.OrderKitchenResponse withTickets(RestaurantOrderEntity order, List<KitchenTicketEntity> tickets) {
        return OrderDtos.OrderKitchenResponse.builder()
                .order(toResponse(order))
                .tickets(tickets.stream().map(kitchenTicketService::toResponse).toList())
                .build();
    }

    private RestaurantOrderItemEntity requireItem(RestaurantOrderEntity order, UUID itemId) {
        return order.getItems().stream()
                .filter(i -> itemId.equals(i.getId()))
                .findFirst()
                .orElseThrow(() -> new BusinessException("Line not found on this order"));
    }

    private RestaurantTableEntity resolveTable(
            RestaurantOrderEntity.OrderType type, UUID tableId, UUID tenantId) {
        if (type == RestaurantOrderEntity.OrderType.TAKEAWAY) {
            if (tableId != null) {
                throw new BusinessException("A takeaway order has no table");
            }
            return null;
        }
        if (tableId == null) {
            throw new BusinessException("Pick a table to seat this order");
        }
        RestaurantTableEntity table = tableRepository.findByIdAndTenantIdForUpdate(tableId, tenantId)
                .orElseThrow(() -> new BusinessException("Table not found"));

        // uk_rest_order_open_table is the real guarantee for a table's own tab;
        // this is the readable message for the common case where one server got
        // there first, and the only guard against seating a joined table.
        requireTableFree(table, tenantId, "");
        return table;
    }

    /**
     * Refuses a table somebody is on — as a tab's own table or joined to one.
     * The caller holds the table's row lock, so the answer stays true until commit.
     *
     * @param ifTabbed appended when another tab sits on it directly, e.g. a hint to merge
     */
    private void requireTableFree(RestaurantTableEntity table, UUID tenantId, String ifTabbed) {
        orderRepository.findOpenByTableId(tenantId, table.getId()).ifPresent(open -> {
            throw new BusinessException(tableBusy(table) + " (order " + open.getOrderNumber() + ")" + ifTabbed);
        });
        orderTableRepository.findByTableId(tenantId, table.getId()).ifPresent(joined -> {
            throw new BusinessException(tableBusy(table) + " (joined to order "
                    + joined.getOrder().getOrderNumber() + ")");
        });
    }

    private static boolean isJoined(RestaurantOrderEntity order, RestaurantTableEntity table) {
        return order.getJoinedTables().stream().anyMatch(j -> j.getTable().getId().equals(table.getId()));
    }

    /** One wording for "somebody is already on that table", so losing the check
     *  and losing the constraint read the same to the server holding the tablet.
     *  The constraint path cannot name the winning order: the transaction is
     *  already poisoned by then, so re-reading it would fail. */
    private String tableBusy(RestaurantTableEntity table) {
        return "Table " + table.getName() + " already has an open tab";
    }

    /** Walks the cause chain for a named constraint, so an unrelated integrity
     *  violation is never dressed up as a friendly message. */
    private static boolean mentionsConstraint(Throwable ex, String constraint) {
        for (Throwable t = ex; t != null && t != t.getCause(); t = t.getCause()) {
            String message = t.getMessage();
            if (message != null && message.toLowerCase().contains(constraint)) {
                return true;
            }
        }
        return false;
    }

    /** Frees the tab's own table and every table joined to it. Deleting the join
     *  rows is what lets V71's unique key take those tables again. */
    private void freeTable(RestaurantOrderEntity order) {
        if (order.getTable() != null) {
            order.getTable().setStatus(RestaurantTableEntity.TableStatus.AVAILABLE);
        }
        for (RestaurantOrderTableEntity joined : order.getJoinedTables()) {
            joined.getTable().setStatus(RestaurantTableEntity.TableStatus.AVAILABLE);
        }
        order.getJoinedTables().clear();
    }

    /** Explicit branchId wins, then the user's primary branch, then the tenant
     *  default — the same chain createSale uses, so a tab and its sale agree. */
    private BranchEntity resolveBranch(UUID requestedBranchId, UUID tenantId, UUID currentUserId) {
        if (requestedBranchId != null) {
            return branchRepository.findByIdAndTenantId(requestedBranchId, tenantId)
                    .orElseThrow(() -> new BusinessException("Branch not found: " + requestedBranchId));
        }
        UUID primaryBranchId = currentUserId == null ? null
                : userRepository.findById(currentUserId)
                        .map(u -> u.getPrimaryBranch() == null ? null : u.getPrimaryBranch().getId())
                        .orElse(null);
        if (primaryBranchId != null) {
            return branchRepository.findByIdAndTenantId(primaryBranchId, tenantId)
                    .orElseThrow(() -> new BusinessException("Primary branch not found"));
        }
        return branchRepository.findByIsDefaultTrueAndTenantId(tenantId)
                .orElseThrow(() -> new BusinessException("Default branch not found and no branchId provided"));
    }

    private UUID currentUserId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth.getName() == null) {
            return null;
        }
        try {
            return UUID.fromString(auth.getName());
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private String label(RestaurantOrderEntity order) {
        String where = order.getTable() != null ? order.tableLabel()
                : order.getSplitFromId() != null ? "Split bill"
                : "Takeaway";
        return "Order " + order.getOrderNumber() + " · " + where;
    }

    // ------------------------------------------------------------------
    // Mapping
    // ------------------------------------------------------------------

    private OrderDtos.OrderResponse toResponse(RestaurantOrderEntity order) {
        List<OrderDtos.OrderItemResponse> items = order.getItems().stream()
                .map(this::toResponse)
                .toList();

        return OrderDtos.OrderResponse.builder()
                .id(order.getId())
                .orderNumber(order.getOrderNumber())
                .label(label(order))
                .businessDate(order.getBusinessDate())
                .orderType(order.getOrderType())
                .status(order.getStatus())
                .branchId(order.getBranch() != null ? order.getBranch().getId() : null)
                .tableId(order.getTable() != null ? order.getTable().getId() : null)
                .tableName(order.getTable() != null ? order.getTable().getName() : null)
                .joinedTables(order.getJoinedTables().stream()
                        .map(j -> OrderDtos.JoinedTable.builder()
                                .id(j.getTable().getId())
                                .name(j.getTable().getName())
                                .build())
                        .toList())
                .customerId(order.getCustomerId())
                .covers(order.getCovers())
                .openedBy(order.getOpenedBy())
                .servedBy(order.getServedBy())
                .saleId(order.getSaleId())
                .roundCount(order.getRoundCount())
                .openedAt(order.getOpenedAt())
                .settledAt(order.getSettledAt())
                .splitFromId(order.getSplitFromId())
                .runningTotal(runningTotal(order))
                .items(items)
                .build();
    }

    private OrderDtos.OrderItemResponse toResponse(RestaurantOrderItemEntity item) {
        return OrderDtos.OrderItemResponse.builder()
                .id(item.getId())
                .productId(item.getProductId())
                .itemName(item.getItemName())
                .quantity(item.getQuantity())
                .firedQuantity(item.getFiredQuantity())
                .voidedQuantity(item.getVoidedQuantity())
                .billableQuantity(item.billableQuantity())
                .pendingQuantity(item.pendingQuantity())
                .unitPriceSnapshot(item.getUnitPriceSnapshot())
                .discountAmount(item.getDiscountAmount())
                .notes(item.getNotes())
                .sortOrder(item.getSortOrder())
                .toppings(item.getToppings().stream()
                        .map(t -> OrderDtos.OrderItemToppingResponse.builder()
                                .id(t.getId())
                                .toppingId(t.getToppingId())
                                .toppingName(t.getToppingName())
                                .quantity(t.getQuantity())
                                .unitPrice(t.getUnitPrice())
                                .priceMode(t.getPriceMode())
                                .build())
                        .toList())
                .build();
    }

    /**
     * Indicative only — snapshots, no tax, no loyalty. The bill is whatever
     * createSale computes at settle. This exists so the floor view can show a
     * running figure without pricing anything itself.
     */
    private BigDecimal runningTotal(RestaurantOrderEntity order) {
        BigDecimal total = BigDecimal.ZERO;
        for (RestaurantOrderItemEntity item : order.getItems()) {
            BigDecimal qty = item.billableQuantity();
            if (qty.signum() <= 0) {
                continue;
            }
            BigDecimal perUnit = item.getUnitPriceSnapshot();
            for (RestaurantOrderItemToppingEntity topping : item.getToppings()) {
                perUnit = perUnit.add(topping.getUnitPrice().multiply(topping.getQuantity()));
            }
            // Same pro-rating the bill uses, so the floor figure and the sale
            // do not disagree on a partly-voided discounted line.
            total = total.add(perUnit.multiply(qty)).subtract(billableDiscount(item));
        }
        return total;
    }
}
