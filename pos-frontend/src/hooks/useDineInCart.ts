'use client';

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Product } from '@/types/inventory';
import { QK } from '@/lib/queryKeys';
import { getApiErrorMessage } from '@/lib/utils';
import { inventoryService } from '@/services/inventoryService';
import {
  restaurantOrderService,
  type OrderItemRequest,
  type OrderItemResponse,
  type RepricedLine,
  type RestaurantOrder,
} from '@/services/restaurantOrderService';
import {
  lineKey,
  stockForBranch,
  useCartTotals,
  type CartItem,
  type CartItemTopping,
  type CartView,
  type TaxContext,
} from './useCart';

/**
 * The cart, when the cart is a tab.
 *
 * In retail the cart is `useState` and dies on reload. Here the lines live in
 * `restaurant_orders` / `restaurant_order_items`, so this hook owns no line
 * state at all: it reads the order, renders it as `CartItem[]`, and turns every
 * cart gesture into the matching request. Reloading the terminal — or picking
 * the tab up on another till — shows the same tab, which is the whole point of
 * the order aggregate.
 *
 * It implements the same `CartView` interface `useCart` does, so the terminal
 * swaps one for the other and every retail code path stays exactly as it was.
 *
 * Two things this deliberately does NOT do:
 *
 *  - **No kitchen firing.** `POST /orders/{id}/fire` does not exist on
 *    `RestaurantOrderController`; tickets arrive with V64 in Phase 3. In Phase 2
 *    adding the item to the tab *is* the persistence and the kitchen is told
 *    verbally, so there is nothing here to call and no control that claims to.
 *  - **No per-line discount.** `UpdateItemRequest` carries `quantity`, `notes`
 *    and `courseNo` and nothing else, so a discount typed here could not be
 *    stored and would vanish at settle. The terminal hides the control rather
 *    than offering one that lies.
 */

/** Another till may add a round to this tab. The project-wide freshness interval. */
const ORDER_POLL_MS = 15_000;

/**
 * One catalogue read per terminal session, used for two things an order line
 * cannot answer on its own:
 *
 *  - the product's `categoryId`, which is how `useCartTotals` resolves the tax
 *    rate (an order item carries only a name and a price snapshot);
 *  - the product's CURRENT `basePrice`, which is what `createSale` will bill at
 *    settle — the difference against the snapshot is the re-price warning.
 */
const MENU_PAGE_SIZE = 500;

export interface UseDineInCartOptions {
  /** The tab being worked on, or null when the terminal is in retail mode. */
  orderId: string | null;
  /** `hasFeature('RESTAURANT') && restaurantMode`. False keeps every query idle. */
  enabled: boolean;
  taxContext: TaxContext | null;
  taxInclusive: boolean;
  /** The drawer's branch, for the stock ceiling. */
  branchId?: string;
}

export interface DineInCart extends CartView {
  /** The OPEN tab. Undefined while loading, or once it is settled/voided. */
  order: RestaurantOrder | undefined;
  isLoading: boolean;
  /** A request is in flight — the till should not fire another. */
  isBusy: boolean;
  /**
   * What settle will re-price, computed BEFORE the cashier commits by comparing
   * each line's snapshot against the live menu price. The server returns its own
   * authoritative list in `SettleResponse.repricedLines`; this is the half that
   * can be shown while the sale can still be stopped.
   */
  repricedPreview: RepricedLine[];
  /** The tab was loaded but is no longer OPEN (settled or voided elsewhere). */
  isClosed: boolean;
}

/**
 * The merge signature of an order line, in exactly the terms `lineKey` uses for
 * a cart line — so tapping the same dish with the same add-ons twice bumps the
 * existing line's quantity instead of growing a second identical row.
 */
function orderLineKey(item: OrderItemResponse): string {
  return lineKey(
    item.productId ?? item.id,
    item.toppings.map(toCartTopping),
    item.notes ?? '',
  );
}

function toCartTopping(topping: OrderItemResponse['toppings'][number]): CartItemTopping {
  return {
    toppingId: topping.toppingId,
    name: topping.toppingName,
    quantity: topping.quantity,
    unitPrice: topping.unitPrice,
    priceMode: topping.priceMode,
  };
}

/**
 * An order line as a cart line.
 *
 * `lineId` is the SERVER's line id, so every callback the terminal already has
 * addresses the right row without a translation layer. `cartQuantity` is the
 * billable quantity, and fully-voided lines are filtered out before this runs,
 * so it never shows a line the bill will not charge for.
 *
 * `basePrice` is the ordered snapshot — what the customer was quoted. Where the
 * menu has since moved, `repricedPreview` says so rather than silently redrawing
 * the tab at the new price.
 */
function toCartItem(item: OrderItemResponse, menu: Map<string, Product>): CartItem {
  const product = item.productId ? menu.get(item.productId) : undefined;
  return {
    // Product identity. A custom/open line has no catalogue row, so it borrows
    // its own line id — nothing keys stock off it because `isCustom` is set.
    id: item.productId ?? item.id,
    name: item.itemName,
    sku: product?.sku ?? '',
    barcode: product?.barcode,
    basePrice: item.unitPriceSnapshot,
    stockQuantity: product?.stockQuantity ?? 0,
    stockLevels: product?.stockLevels,
    trackStock: product?.trackStock,
    lowStockThreshold: product?.lowStockThreshold ?? 0,
    imageUrl: product?.imageUrl,
    categoryId: product?.categoryId,
    isActive: true,
    createdAt: '',
    updatedAt: '',
    // Line identity.
    lineId: item.id,
    cartQuantity: item.billableQuantity,
    discountAmount: item.discountAmount,
    isCustom: !item.productId,
    toppings: item.toppings.length > 0 ? item.toppings.map(toCartTopping) : undefined,
    notes: item.notes ?? undefined,
  };
}

export function useDineInCart({
  orderId,
  enabled,
  taxContext,
  taxInclusive,
  branchId,
}: UseDineInCartOptions): DineInCart {
  const queryClient = useQueryClient();
  const active = enabled && !!orderId;

  const { data: loadedOrder, isLoading } = useQuery({
    queryKey: QK.restaurantOrder(orderId ?? ''),
    queryFn: () => restaurantOrderService.getOrder(orderId!),
    enabled: active,
    refetchInterval: active ? ORDER_POLL_MS : false,
  });

  const { data: menuPage } = useQuery({
    queryKey: QK.restaurantMenuSnapshot,
    queryFn: () => inventoryService.getProducts(0, MENU_PAGE_SIZE, { isActive: true }),
    enabled: active,
    staleTime: 5 * 60 * 1000,
  });

  const menu = useMemo(
    () => new Map((menuPage?.content ?? []).map((p) => [p.id, p])),
    [menuPage],
  );

  // A settled or voided tab is not a cart. The terminal watches `isClosed` and
  // drops back to retail rather than letting anyone ring into a closed order.
  const order = loadedOrder?.status === 'OPEN' ? loadedOrder : undefined;
  const isClosed = !!loadedOrder && loadedOrder.status !== 'OPEN';

  const items = useMemo<CartItem[]>(() => {
    if (!order) return [];
    return order.items
      .filter((item) => item.billableQuantity > 0)
      .map((item) => toCartItem(item, menu));
  }, [order, menu]);

  const totals = useCartTotals(items, taxContext, taxInclusive);

  const repricedPreview = useMemo<RepricedLine[]>(() => {
    if (!order || menu.size === 0) return [];
    const moved: RepricedLine[] = [];
    for (const item of order.items) {
      if (item.billableQuantity <= 0 || !item.productId) continue;
      const product = menu.get(item.productId);
      if (!product) continue;
      // Half a cent of slack: these are two NUMERIC(12,2) values that arrived as
      // JSON doubles, not a float computation.
      if (Math.abs(product.basePrice - item.unitPriceSnapshot) > 0.005) {
        moved.push({
          itemName: item.itemName,
          orderedPrice: item.unitPriceSnapshot,
          billedPrice: product.basePrice,
        });
      }
    }
    return moved;
  }, [order, menu]);

  // Every write returns the whole order, so the cache is replaced with the
  // server's version rather than patched — the tab on screen is always the tab
  // in the database. The floor tiles are invalidated in the same breath.
  const applyOrder = useCallback(
    (updated: RestaurantOrder) => {
      queryClient.setQueryData(QK.restaurantOrder(updated.id), updated);
      queryClient.invalidateQueries({ queryKey: QK.restaurantOpenOrders });
    },
    [queryClient],
  );

  const addItems = useMutation({
    mutationFn: ({ id, lines }: { id: string; lines: OrderItemRequest[] }) =>
      restaurantOrderService.addItems(id, { items: lines }),
    onSuccess: applyOrder,
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not add that to the tab')),
  });

  const updateItem = useMutation({
    mutationFn: ({ id, itemId, quantity }: { id: string; itemId: string; quantity: number }) =>
      restaurantOrderService.updateItem(id, itemId, { quantity }),
    onSuccess: applyOrder,
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not change that line')),
  });

  const voidItem = useMutation({
    mutationFn: ({ id, itemId }: { id: string; itemId: string }) =>
      restaurantOrderService.voidItem(id, itemId),
    onSuccess: applyOrder,
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not remove that line')),
  });

  const isBusy = addItems.isPending || updateItem.isPending || voidItem.isPending;

  /**
   * How much of this product the tab already carries. Stock is a product-level
   * ceiling, so it counts every line — the same rule `useCart.addToCart` applies
   * to a retail cart.
   */
  const orderedQuantityOf = useCallback(
    (productId: string, exceptLineId?: string) =>
      (order?.items ?? [])
        .filter((i) => i.productId === productId && i.id !== exceptLineId)
        .reduce((sum, i) => sum + i.billableQuantity, 0),
    [order],
  );

  const addToCart = useCallback(
    (product: Product, toppings: CartItemTopping[] = [], notes = '') => {
      if (!order || isBusy) return;

      // Identical rule to retail, and keyed off `trackStock` rather than the
      // number: `stockQuantity` is a server-side SUM that reads 0 for a
      // made-to-order dish, which is most of a restaurant's menu.
      const branchStock = stockForBranch(product, branchId);
      const alreadyOrdered = orderedQuantityOf(product.id);
      if (branchStock <= 0) {
        toast.error('Product out of stock at this branch');
        return;
      }
      if (alreadyOrdered >= branchStock) {
        toast.error(`Only ${branchStock} in stock at this branch`);
        return;
      }

      // `addItems` appends unconditionally server-side, so merging is decided
      // here — otherwise a second tap of the same dish grows a duplicate row and
      // the tab reads nothing like the cart it replaces.
      const key = lineKey(product.id, toppings, notes);
      const existing = order.items.find(
        (i) => i.billableQuantity > 0 && orderLineKey(i) === key,
      );
      if (existing) {
        updateItem.mutate({
          id: order.id,
          itemId: existing.id,
          quantity: existing.quantity + 1,
        });
        return;
      }

      addItems.mutate({
        id: order.id,
        lines: [
          {
            productId: product.id,
            quantity: 1,
            notes: notes.trim() || undefined,
            // The server re-resolves every add-on price from its own row; a
            // FIXED topping's figure here is discarded, exactly as at checkout.
            toppings: toppings.length
              ? toppings.map((t) => ({
                  toppingId: t.toppingId,
                  quantity: t.quantity,
                  unitPrice: t.priceMode === 'PROMPT' ? t.unitPrice : undefined,
                }))
              : undefined,
          },
        ],
      });
    },
    [order, isBusy, branchId, orderedQuantityOf, addItems, updateItem],
  );

  const addCustomItem = useCallback(
    (name: string, price: number, quantity: number = 1) => {
      if (!order || isBusy) return;
      addItems.mutate({
        id: order.id,
        lines: [{ itemName: name.trim(), quantity, unitPrice: price }],
      });
    },
    [order, isBusy, addItems],
  );

  const removeFromCart = useCallback(
    (lineId: string) => {
      if (!order || isBusy) return;
      voidItem.mutate({ id: order.id, itemId: lineId });
    },
    [order, isBusy, voidItem],
  );

  const updateQuantity = useCallback(
    (lineId: string, quantity: number) => {
      if (!order || isBusy) return;
      const item = order.items.find((i) => i.id === lineId);
      if (!item) return;

      // Taking a line to zero is a void, not an update: the row has to keep
      // saying how much was ordered and how much was written off.
      if (quantity <= 0) {
        voidItem.mutate({ id: order.id, itemId: lineId });
        return;
      }

      // Only when the catalogue row is to hand. If it is not, the ceiling is left
      // to `createSale` at settle, which is the authority on it either way.
      const product = item.productId ? menu.get(item.productId) : undefined;
      if (product) {
        const branchStock = stockForBranch(product, branchId);
        const others = orderedQuantityOf(product.id, lineId);
        if (quantity + others > branchStock) {
          toast.error(`Only ${branchStock} in stock at this branch`);
          return;
        }
      }

      updateItem.mutate({ id: order.id, itemId: lineId, quantity });
    },
    [order, isBusy, menu, branchId, orderedQuantityOf, updateItem, voidItem],
  );

  /**
   * Unreachable by design — the terminal hides the discount control on a tab
   * because there is no endpoint that could store the number. Present only so
   * this satisfies `CartView`.
   */
  const setItemDiscount = useCallback(() => {}, []);

  /** A tab is not cleared, it is settled or voided. Both are explicit actions. */
  const clearCart = useCallback(() => {}, []);

  return {
    order,
    isLoading: active && isLoading,
    isBusy,
    isClosed,
    repricedPreview,
    items,
    addToCart,
    addCustomItem,
    removeFromCart,
    updateQuantity,
    setItemDiscount,
    clearCart,
    ...totals,
  };
}
