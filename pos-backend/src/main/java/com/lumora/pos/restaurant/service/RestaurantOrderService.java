package com.lumora.pos.restaurant.service;

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
import com.lumora.pos.restaurant.repository.RestaurantOrderRepository;
import com.lumora.pos.restaurant.repository.RestaurantTableRepository;
import com.lumora.pos.restaurant.repository.ToppingRepository;
import com.lumora.pos.sales.dto.SaleRequest;
import com.lumora.pos.sales.dto.SaleResponse;
import com.lumora.pos.sales.service.SaleService;
import com.lumora.pos.tenant.TenantContext;
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

    private final RestaurantOrderRepository orderRepository;
    private final RestaurantTableRepository tableRepository;
    private final RestaurantOrderCounterDao counterDao;
    private final ProductRepository productRepository;
    private final ToppingRepository toppingRepository;
    private final BranchRepository branchRepository;
    private final UserRepository userRepository;
    private final SaleService saleService;
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
     * Quantity, notes and course only.
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
            if (quantity.compareTo(item.getFiredQuantity()) < 0) {
                throw new BusinessException("The kitchen already has " + item.getFiredQuantity()
                        + " of this. Void it instead of reducing the quantity.");
            }
            if (quantity.compareTo(item.getVoidedQuantity()) < 0) {
                throw new BusinessException("Cannot go below the quantity already voided on this line");
            }
            item.setQuantity(quantity);
        }
        if (request.getNotes() != null) {
            item.setNotes(request.getNotes().isBlank() ? null : request.getNotes().trim());
        }
        if (request.getCourseNo() != null) {
            item.setCourseNo(request.getCourseNo());
        }

        RestaurantOrderEntity saved = orderRepository.save(order);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER_ITEM", itemId, null,
                Map.of("quantity", item.getQuantity().toPlainString()));
        return toResponse(saved);
    }

    /**
     * Voids some or all of a line. Voided quantity is counted, never subtracted
     * from {@code quantity}: the kitchen may already be cooking it, and Phase 3
     * needs to know exactly how much to un-cook.
     */
    @Transactional
    public OrderDtos.OrderResponse voidItem(UUID orderId, UUID itemId, OrderDtos.VoidItemRequest request) {
        RestaurantOrderEntity order = requireOpen(orderId);
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

        item.setVoidedQuantity(item.getVoidedQuantity().add(amount));

        RestaurantOrderEntity saved = orderRepository.save(order);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER_ITEM", itemId, null, Map.of(
                "voided", amount.toPlainString(),
                "reason", request != null && request.getReason() != null ? request.getReason() : ""));
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

        SaleResponse sale = saleService.createSale(SaleRequest.builder()
                .customerId(order.getCustomerId())
                .branchId(order.getBranch().getId())
                .paymentMethod(request.getPaymentMethod())
                .cashTendered(request.getCashTendered())
                .pointsToRedeem(request.getPointsToRedeem())
                .items(billable.stream().map(this::toSaleLine).toList())
                .build());

        order.setSaleId(sale.getId());
        order.setStatus(RestaurantOrderEntity.OrderStatus.SETTLED);
        order.setSettledAt(LocalDateTime.now());
        freeTable(order);
        orderRepository.save(order);

        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", orderId, null, Map.of(
                "status", "SETTLED", "saleId", sale.getId()));

        return OrderDtos.SettleResponse.builder()
                .sale(sale)
                .label(label(order))
                .repricedLines(repricedLines(billable, sale))
                .build();
    }

    @Transactional
    public OrderDtos.OrderResponse voidOrder(UUID orderId) {
        UUID tenantId = TenantContext.getTenantId();
        RestaurantOrderEntity order = orderRepository.findByIdAndTenantIdForUpdate(orderId, tenantId)
                .orElseThrow(() -> new BusinessException("Order not found"));
        if (order.getStatus() != RestaurantOrderEntity.OrderStatus.OPEN) {
            throw new BusinessException("This order is already " + order.getStatus());
        }

        order.setStatus(RestaurantOrderEntity.OrderStatus.VOIDED);
        freeTable(order);
        RestaurantOrderEntity saved = orderRepository.save(order);
        auditService.log(AuditAction.UPDATE, "RESTAURANT_ORDER", orderId, null, Map.of("status", "VOIDED"));
        return toResponse(saved);
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
                .courseNo(request.getCourseNo() != null ? request.getCourseNo() : 1)
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
        RestaurantTableEntity table = tableRepository.findByIdAndTenantId(tableId, tenantId)
                .orElseThrow(() -> new BusinessException("Table not found"));

        // uk_rest_order_open_table is the real guarantee; this is the readable
        // message for the common case where one server got there first.
        orderRepository.findOpenByTableId(tenantId, tableId).ifPresent(open -> {
            throw new BusinessException(tableBusy(table) + " (order " + open.getOrderNumber() + ")");
        });
        return table;
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

    private void freeTable(RestaurantOrderEntity order) {
        if (order.getTable() != null) {
            order.getTable().setStatus(RestaurantTableEntity.TableStatus.AVAILABLE);
        }
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
        String where = order.getTable() != null ? order.getTable().getName() : "Takeaway";
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
                .customerId(order.getCustomerId())
                .covers(order.getCovers())
                .openedBy(order.getOpenedBy())
                .servedBy(order.getServedBy())
                .saleId(order.getSaleId())
                .roundCount(order.getRoundCount())
                .openedAt(order.getOpenedAt())
                .settledAt(order.getSettledAt())
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
                .unitPriceSnapshot(item.getUnitPriceSnapshot())
                .discountAmount(item.getDiscountAmount())
                .notes(item.getNotes())
                .courseNo(item.getCourseNo())
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
