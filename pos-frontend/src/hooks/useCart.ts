import { useState, useCallback, useMemo } from 'react';
import { Product } from '@/types/inventory';
import { toast } from 'sonner';
import { TaxRate } from '@/services/taxService';
import { Category } from '@/types/inventory';

export interface CartItem extends Product {
  cartQuantity: number;
  /** Per-line discount amount in tenant currency. Default 0. Capped at line subtotal. */
  discountAmount: number;
  /** True for an open/custom line not in the catalog (no productId, no stock). */
  isCustom?: boolean;
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

  const addToCart = useCallback((product: Product) => {
    setItems((prevItems) => {
      const branchStock = stockForBranch(product, selectedBranchId);
      const existingItem = prevItems.find((item) => item.id === product.id);

      if (existingItem) {
        if (existingItem.cartQuantity >= branchStock) {
          toast.error(`Only ${branchStock} in stock at this branch`);
          return prevItems;
        }
        return prevItems.map((item) =>
          item.id === product.id
            ? { ...item, cartQuantity: item.cartQuantity + 1 }
            : item
        );
      }

      if (branchStock <= 0) {
        toast.error("Product out of stock at this branch");
        return prevItems;
      }

      return [...prevItems, { ...product, cartQuantity: 1, discountAmount: 0 }];
    });
  }, [selectedBranchId]);

  /** Adds an open/custom line (item not in the catalog) — no stock, no productId. */
  const addCustomItem = useCallback((name: string, price: number, quantity: number = 1) => {
    setItems((prevItems) => [
      ...prevItems,
      {
        id: `custom-${crypto.randomUUID()}`,
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

  const removeFromCart = useCallback((productId: string) => {
    setItems((prevItems) => prevItems.filter((item) => item.id !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    setItems((prevItems) => {
      const item = prevItems.find(i => i.id === productId);
      if (!item) return prevItems;
      const branchStock = stockForBranch(item, selectedBranchId);
      if (quantity > branchStock) {
        toast.error(`Only ${branchStock} in stock at this branch`);
        return prevItems;
      }
      return prevItems.map((i) => {
        if (i.id !== productId) return i;
        const newSubtotal = i.basePrice * quantity;
        const clamped = Math.min(i.discountAmount, newSubtotal);
        return { ...i, cartQuantity: quantity, discountAmount: clamped };
      });
    });
  }, [removeFromCart, selectedBranchId]);

  const setItemDiscount = useCallback((productId: string, discount: number) => {
    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.id !== productId) return item;
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

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.basePrice * item.cartQuantity, 0),
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

      const lineSubtotal = item.basePrice * item.cartQuantity;
      const taxableBase = Math.max(0, lineSubtotal - item.discountAmount);
      // Round each line's tax to 2dp before summing, mirroring the backend
      // (per line, HALF_UP). Inclusive: extract the VAT already inside the price
      // (base − base/(1+rate)). Exclusive: add VAT on top (base × rate).
      const lineTax = taxInclusive
        ? taxableBase - Math.round((taxableBase / (1 + rate)) * 100) / 100
        : Math.round(taxableBase * rate * 100) / 100;
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
