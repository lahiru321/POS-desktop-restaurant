import { useState, useCallback, useMemo } from 'react';
import { Product } from '@/types/inventory';
import { toast } from 'sonner';
import { TaxRate } from '@/services/taxService';
import { Category } from '@/types/inventory';

/** One add-on chosen on a cart line. Quantity is per parent unit. */
export interface CartItemTopping {
  toppingId: string;
  name: string;
  quantity: number;
  /** For a PROMPT topping this is the cashier's typed figure; the server re-checks it. */
  unitPrice: number;
  priceMode: 'FIXED' | 'PROMPT';
}

export interface CartItem extends Product {
  /**
   * Identity of this cart LINE, not of the product.
   *
   * A burger with cheese and a burger without are two lines of the same product,
   * so the product id can no longer serve as the key. Every cart callback takes
   * this instead.
   */
  lineId: string;
  cartQuantity: number;
  /** Per-line discount amount in tenant currency. Default 0. Capped at line subtotal. */
  discountAmount: number;
  /** True for an open/custom line not in the catalog (no productId, no stock). */
  isCustom?: boolean;
  toppings?: CartItemTopping[];
  /** Free text for the kitchen and the bill: "no chilli". */
  notes?: string;
}

/**
 * Stable signature for a line, so "burger + cheese" merges with another
 * "burger + cheese" but not with "burger + cheese + onions" — and a typed-price
 * topping never merges with the same topping rung at a different price.
 */
export function lineKey(
  productId: string,
  toppings: CartItemTopping[] = [],
  notes = '',
): string {
  const signature = [...toppings]
    .sort((a, b) => a.toppingId.localeCompare(b.toppingId))
    .map((t) => `${t.toppingId}:${t.quantity}:${t.unitPrice}`)
    .join('|');
  return `${productId}#${signature}#${notes.trim()}`;
}

/** What one unit of a line costs in add-ons. */
function toppingsPerUnit(item: CartItem): number {
  return (item.toppings ?? []).reduce((sum, t) => sum + t.unitPrice * t.quantity, 0);
}

export interface TaxContext {
  taxRates: TaxRate[];
  categories: Category[];
}

/**
 * Resolves the tax rate for a product using the chain:
 * Product -> Category -> category.taxRateId -> taxRate.rate
 * Fallback -> Default tax rate
 * Fallback -> 0 (tax-exempt)
 */
function getProductTaxRate(product: Product, taxContext: TaxContext | null): number {
  if (!taxContext || taxContext.taxRates.length === 0) return 0;

  const { taxRates, categories } = taxContext;

  if (product.categoryId) {
    const category = categories.find(c => c.id === product.categoryId);
    if (category?.taxRateId) {
      const categoryTax = taxRates.find(t => t.id === category.taxRateId && t.isActive);
      if (categoryTax) return categoryTax.rate;
    }
  }

  const defaultTax = taxRates.find(t => t.isDefault && t.isActive);
  if (defaultTax) return defaultTax.rate;

  return 0;
}

/**
 * True when a line has no stock ceiling: an open/custom line, or a made-to-order
 * product (V59).
 *
 * `trackStock` is optional on the type so pre-V59 cached payloads still parse;
 * `!== false` therefore reads a missing flag as "tracked", which is what those
 * products were.
 */
function isUnlimited(product: Product | CartItem): boolean {
  if ('isCustom' in product && product.isCustom) return true;
  return product.trackStock === false;
}

/**
 * Returns the in-stock quantity for the currently selected branch. Falls back
 * to the global stockQuantity only when no branch is selected.
 *
 * Made-to-order products are unbounded: `Product.stockQuantity` is a server-side
 * SUM over stock_levels, so an untracked product reports 0 and would otherwise be
 * unsellable. The ceiling must come from the flag, never from the number.
 */
function stockForBranch(product: Product, branchId?: string): number {
  if (isUnlimited(product)) return Number.MAX_SAFE_INTEGER;
  if (branchId && product.stockLevels) {
    return product.stockLevels.find(sl => sl.branchId === branchId)?.quantity ?? 0;
  }
  return product.stockQuantity;
}

export const useCart = (
  taxContext: TaxContext | null = null,
  selectedBranchId?: string,
  /** When true, basePrice is VAT-inclusive: tax is extracted from the price
   *  rather than added on top, and the payable total excludes any added tax. */
  taxInclusive: boolean = false,
) => {
  const [items, setItems] = useState<CartItem[]>([]);

  const addToCart = useCallback((
    product: Product,
    toppings: CartItemTopping[] = [],
    notes = '',
  ) => {
    setItems((prevItems) => {
      const branchStock = stockForBranch(product, selectedBranchId);
      const key = lineKey(product.id, toppings, notes);
      // Stock is a product-level ceiling, so it counts every line of this
      // product, not just the one being merged into.
      const productQuantity = prevItems
        .filter((item) => item.id === product.id)
        .reduce((sum, item) => sum + item.cartQuantity, 0);
      const existingItem = prevItems.find((item) => item.lineId === key);

      if (existingItem) {
        if (productQuantity >= branchStock) {
          toast.error(`Only ${branchStock} in stock at this branch`);
          return prevItems;
        }
        return prevItems.map((item) =>
          item.lineId === key
            ? { ...item, cartQuantity: item.cartQuantity + 1 }
            : item
        );
      }

      if (branchStock <= 0) {
        toast.error("Product out of stock at this branch");
        return prevItems;
      }
      if (productQuantity >= branchStock) {
        toast.error(`Only ${branchStock} in stock at this branch`);
        return prevItems;
      }

      return [...prevItems, {
        ...product,
        lineId: key,
        cartQuantity: 1,
        discountAmount: 0,
        toppings: toppings.length > 0 ? toppings : undefined,
        notes: notes.trim() || undefined,
      }];
    });
  }, [selectedBranchId]);

  /** Adds an open/custom line (item not in the catalog) — no stock, no productId. */
  const addCustomItem = useCallback((name: string, price: number, quantity: number = 1) => {
    const syntheticId = `custom-${crypto.randomUUID()}`;
    setItems((prevItems) => [
      ...prevItems,
      {
        id: syntheticId,
        lineId: syntheticId,
        name: name.trim(),
        sku: '',
        basePrice: price,
        stockQuantity: Number.MAX_SAFE_INTEGER,
        lowStockThreshold: 0,
        isActive: true,
        createdAt: '',
        updatedAt: '',
        cartQuantity: quantity,
        discountAmount: 0,
        isCustom: true,
      },
    ]);
  }, []);

  const removeFromCart = useCallback((lineId: string) => {
    setItems((prevItems) => prevItems.filter((item) => item.lineId !== lineId));
  }, []);

  const updateQuantity = useCallback((lineId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(lineId);
      return;
    }

    setItems((prevItems) => {
      const item = prevItems.find(i => i.lineId === lineId);
      if (!item) return prevItems;
      const branchStock = stockForBranch(item, selectedBranchId);
      // Other lines of the same product already consume part of the ceiling.
      const otherLines = prevItems
        .filter(i => i.id === item.id && i.lineId !== lineId)
        .reduce((sum, i) => sum + i.cartQuantity, 0);
      if (quantity + otherLines > branchStock) {
        toast.error(`Only ${branchStock} in stock at this branch`);
        return prevItems;
      }
      return prevItems.map((i) => {
        if (i.lineId !== lineId) return i;
        // Cap against the DISH's subtotal only, never the topping-inclusive
        // figure: the backend's "discount exceeds line subtotal" guard compares
        // against the parent line alone, and a client that allowed more would
        // have the sale rejected at checkout.
        const newSubtotal = i.basePrice * quantity;
        const clamped = Math.min(i.discountAmount, newSubtotal);
        return { ...i, cartQuantity: quantity, discountAmount: clamped };
      });
    });
  }, [removeFromCart, selectedBranchId]);

  const setItemDiscount = useCallback((lineId: string, discount: number) => {
    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.lineId !== lineId) return item;
        const subtotal = item.basePrice * item.cartQuantity;
        const safe = Math.max(0, Math.min(discount, subtotal));
        if (safe !== discount) {
          toast.warning(`Discount capped at ${subtotal.toFixed(2)}`);
        }
        return { ...item, discountAmount: Number(safe.toFixed(2)) };
      })
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  // Includes add-ons, because that is what the backend accumulates: a topping is
  // its own sale_items row with its own subtotal.
  const subtotal = useMemo(
    () => items.reduce(
      (sum, item) => sum + (item.basePrice + toppingsPerUnit(item)) * item.cartQuantity,
      0,
    ),
    [items]
  );

  const discountAmount = useMemo(
    () => items.reduce((sum, item) => sum + item.discountAmount, 0),
    [items]
  );

  const taxInfo = useMemo(() => {
    const itemTaxes = items.map(item => {
      const rate = getProductTaxRate(item, taxContext);

      let name = 'Tax';
      if (taxContext) {
        const { taxRates, categories } = taxContext;
        // Resolve the rate name with the same precedence as getProductTaxRate:
        // the product's category-specific rate wins, falling back to the default.
        // (A plain find() with `|| t.isDefault` would wrongly return the default
        // first whenever it appears earlier in the array.)
        const category = categories.find(c => c.id === item.categoryId);
        const categoryTax = category?.taxRateId
          ? taxRates.find(t => t.id === category.taxRateId && t.isActive)
          : undefined;
        const resolvedTax = categoryTax ?? taxRates.find(t => t.isDefault && t.isActive);
        name = resolvedTax?.name || 'Tax';
      }

      // Round per SUB-LINE, not per cart line. The backend stores a topping as
      // its own sale_items row and rounds each row to 2dp, so folding the dish
      // and its add-ons into one base before rounding drifts by up to a cent per
      // topping — and the drift only shows up at the drawer.
      const parentBase = Math.max(0, item.basePrice * item.cartQuantity - item.discountAmount);
      const bases = [
        parentBase,
        ...(item.toppings ?? []).map(t => t.unitPrice * t.quantity * item.cartQuantity),
      ];

      // Inclusive: extract the VAT already inside the price (base − base/(1+rate)).
      // Exclusive: add VAT on top (base × rate). HALF_UP at 2dp, mirroring
      // SaleService.applyLineMath.
      const roundTax = (base: number) => taxInclusive
        ? base - Math.round((base / (1 + rate)) * 100) / 100
        : Math.round(base * rate * 100) / 100;

      const lineTax = bases.reduce((sum, base) => sum + roundTax(base), 0);
      return { rate, name, amount: lineTax };
    });

    const totalAmount = itemTaxes.reduce((sum, t) => sum + t.amount, 0);

    let label = 'Tax';
    if (items.length > 0) {
      const uniqueRates = new Set(itemTaxes.map(t => t.rate));
      if (uniqueRates.size === 1) {
        const rate = Array.from(uniqueRates)[0];
        const names = Array.from(new Set(itemTaxes.map(t => t.name)));
        const name = names.length === 1 ? names[0] : 'Tax';
        label = `${name} (${(rate * 100).toFixed(0)}%)`;
      } else {
        label = 'Combined Tax';
      }
    } else {
      const defaultTax = taxContext?.taxRates.find(t => t.isDefault && t.isActive);
      if (defaultTax) {
        label = `${defaultTax.name} (${(defaultTax.rate * 100).toFixed(0)}%)`;
      }
    }

    return { totalAmount, label };
  }, [items, taxContext, taxInclusive]);

  const total = useMemo(
    // Inclusive: tax is already inside the prices, so the payable is just
    // subtotal − discount. Exclusive: add the computed tax on top.
    () => (taxInclusive ? subtotal - discountAmount : subtotal - discountAmount + taxInfo.totalAmount),
    [subtotal, discountAmount, taxInfo.totalAmount, taxInclusive]
  );

  return {
    items,
    addToCart,
    addCustomItem,
    removeFromCart,
    updateQuantity,
    setItemDiscount,
    clearCart,
    subtotal,
    discountAmount,
    taxAmount: taxInfo.totalAmount,
    taxLabel: taxInfo.label,
    taxInclusive,
    total,
    itemCount: items.reduce((sum, item) => sum + item.cartQuantity, 0),
  };
};
