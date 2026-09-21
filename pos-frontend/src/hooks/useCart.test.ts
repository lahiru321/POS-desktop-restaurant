import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCart, useCartTotals } from "./useCart";
import type { CartItem, CartItemTopping } from "./useCart";
import type { Product } from "@/types/inventory";
import type { TaxContext } from "./useCart";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Cola",
    sku: "C-001",
    basePrice: 10,
    stockQuantity: 5,
    lowStockThreshold: 1,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useCart", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useCart());
    expect(result.current.items).toHaveLength(0);
    expect(result.current.subtotal).toBe(0);
    expect(result.current.total).toBe(0);
    expect(result.current.itemCount).toBe(0);
  });

  it("adds a product and computes subtotal", () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addToCart(makeProduct({ basePrice: 12.5 })));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].cartQuantity).toBe(1);
    expect(result.current.subtotal).toBe(12.5);
    expect(result.current.itemCount).toBe(1);
  });

  it("increments quantity when the same product is added twice", () => {
    const { result } = renderHook(() => useCart());
    const product = makeProduct({ basePrice: 5 });

    act(() => result.current.addToCart(product));
    act(() => result.current.addToCart(product));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].cartQuantity).toBe(2);
    expect(result.current.subtotal).toBe(10);
  });

  it("blocks adding past the global stock when no branch is selected", () => {
    const { result } = renderHook(() => useCart());
    const product = makeProduct({ stockQuantity: 1 });

    act(() => result.current.addToCart(product));
    act(() => result.current.addToCart(product)); // would exceed stock

    expect(result.current.items[0].cartQuantity).toBe(1);
  });

  it("uses per-branch stock when selectedBranchId is provided", () => {
    const product = makeProduct({
      stockQuantity: 999, // global ignored
      stockLevels: [
        { id: "sl1", productId: "p1", branchId: "b1", branchName: "Main", quantity: 1 },
        { id: "sl2", productId: "p1", branchId: "b2", branchName: "West", quantity: 5 },
      ],
    });

    const { result } = renderHook(() => useCart(null, "b1"));
    act(() => result.current.addToCart(product));
    act(() => result.current.addToCart(product)); // branch b1 only has 1
    expect(result.current.items[0].cartQuantity).toBe(1);
  });

  it("removeFromCart drops the item entirely", () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addToCart(makeProduct()));
    act(() => result.current.removeFromCart(result.current.items[0].lineId));
    expect(result.current.items).toHaveLength(0);
  });

  it("updateQuantity to 0 removes the item", () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addToCart(makeProduct()));
    act(() => result.current.updateQuantity(result.current.items[0].lineId, 0));
    expect(result.current.items).toHaveLength(0);
  });

  it("updateQuantity above stock keeps prior quantity", () => {
    const product = makeProduct({ stockQuantity: 3 });
    const { result } = renderHook(() => useCart());
    act(() => result.current.addToCart(product));
    act(() => result.current.updateQuantity(result.current.items[0].lineId, 99));
    expect(result.current.items[0].cartQuantity).toBe(1);
  });

  it("clearCart empties the cart", () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addToCart(makeProduct()));
    act(() => result.current.addToCart(makeProduct({ id: "p2", name: "Chips" })));
    act(() => result.current.clearCart());
    expect(result.current.items).toHaveLength(0);
  });

  it("applies the default tax rate when product has no category", () => {
    const taxContext: TaxContext = {
      taxRates: [
        { id: "t1", name: "VAT", rate: 0.1, isDefault: true, isActive: true } as TaxContext["taxRates"][number],
      ],
      categories: [],
    };
    const { result } = renderHook(() => useCart(taxContext));
    act(() => result.current.addToCart(makeProduct({ basePrice: 100 })));

    expect(result.current.subtotal).toBe(100);
    expect(result.current.taxAmount).toBeCloseTo(10);
    expect(result.current.total).toBeCloseTo(110);
    expect(result.current.taxLabel).toBe("VAT (10%)");
  });

  it("uses the category-specific rate over the default", () => {
    const taxContext: TaxContext = {
      taxRates: [
        { id: "t-default", name: "Std", rate: 0.1, isDefault: true, isActive: true } as TaxContext["taxRates"][number],
        { id: "t-luxury", name: "Luxury", rate: 0.25, isDefault: false, isActive: true } as TaxContext["taxRates"][number],
      ],
      categories: [
        { id: "c1", name: "Watches", taxRateId: "t-luxury", createdAt: "2026-01-01" },
      ],
    };
    const { result } = renderHook(() => useCart(taxContext));
    act(() =>
      result.current.addToCart(makeProduct({ basePrice: 100, categoryId: "c1" }))
    );

    expect(result.current.taxAmount).toBeCloseTo(25);
    expect(result.current.total).toBeCloseTo(125);
    expect(result.current.taxLabel).toBe("Luxury (25%)");
  });

  it("falls back to 0 tax when no rates exist", () => {
    const { result } = renderHook(() => useCart({ taxRates: [], categories: [] }));
    act(() => result.current.addToCart(makeProduct({ basePrice: 50 })));
    expect(result.current.taxAmount).toBe(0);
    expect(result.current.total).toBe(50);
  });

  it("extracts VAT from the price in inclusive mode instead of adding it", () => {
    const taxContext: TaxContext = {
      taxRates: [
        { id: "t1", name: "VAT", rate: 0.18, isDefault: true, isActive: true } as TaxContext["taxRates"][number],
      ],
      categories: [],
    };
    // Third arg = taxInclusive. 100 @ 18% inclusive: VAT = 100 − 100/1.18 = 15.25,
    // and the customer still pays exactly 100 (tax is inside the price).
    const { result } = renderHook(() => useCart(taxContext, undefined, true));
    act(() => result.current.addToCart(makeProduct({ basePrice: 100 })));

    expect(result.current.taxInclusive).toBe(true);
    expect(result.current.taxAmount).toBeCloseTo(15.25);
    expect(result.current.total).toBeCloseTo(100);
  });

  // ------------------------------------------------------------------
  // track_stock (V59)
  // ------------------------------------------------------------------

  describe("made-to-order products (trackStock === false)", () => {
    // The trap this guards: Product.stockQuantity is a server-side SUM over
    // stock_levels, so an untracked product reports 0. Keying the guard off the
    // number rather than the flag makes every dish permanently unsellable.
    const dish = () =>
      makeProduct({ id: "food-1", name: "Chicken Fried Rice", basePrice: 850, stockQuantity: 0, trackStock: false });

    it("can be added even though its stock reads zero", () => {
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(dish()));

      expect(result.current.items).toHaveLength(1);
      expect(result.current.subtotal).toBe(850);
    });

    it("has no quantity ceiling", () => {
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(dish()));
      act(() => result.current.updateQuantity(result.current.items[0].lineId, 40));

      expect(result.current.items[0].cartQuantity).toBe(40);
      expect(result.current.subtotal).toBe(34000);
    });

    it("is unaffected by the selected branch having no stock row", () => {
      const { result } = renderHook(() => useCart(null, "branch-1"));
      act(() => result.current.addToCart(dish()));
      act(() => result.current.addToCart(dish()));

      expect(result.current.items[0].cartQuantity).toBe(2);
    });

    it("still enforces the ceiling for a tracked product", () => {
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(makeProduct({ stockQuantity: 1, trackStock: true })));
      act(() => result.current.addToCart(makeProduct({ stockQuantity: 1, trackStock: true })));

      expect(result.current.items[0].cartQuantity).toBe(1);
    });

    it("treats a missing trackStock flag as tracked, so pre-V59 payloads are unchanged", () => {
      const { result } = renderHook(() => useCart());
      // No trackStock key at all — what a response cached before V59 looks like.
      const legacy = makeProduct({ stockQuantity: 0 });
      act(() => result.current.addToCart(legacy));

      expect(result.current.items).toHaveLength(0);
    });
  });

  // The merge key decides what counts as "the same line". Before toppings the
  // product id was enough; now a burger with cheese and a plain burger are two
  // lines of one product, and every callback addresses a line rather than a
  // product.
  describe("line identity with toppings", () => {
    const cheese = (overrides: Partial<CartItemTopping> = {}): CartItemTopping => ({
      toppingId: "t-cheese",
      name: "Cheese",
      quantity: 1,
      unitPrice: 50,
      priceMode: "FIXED",
      ...overrides,
    });
    const onions = (): CartItemTopping => ({
      toppingId: "t-onions",
      name: "Onions",
      quantity: 1,
      unitPrice: 20,
      priceMode: "FIXED",
    });
    const burger = () => makeProduct({ id: "b1", name: "Burger", basePrice: 500, trackStock: false });

    it("merges two identical topping selections into one line", () => {
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(burger(), [cheese()]));
      act(() => result.current.addToCart(burger(), [cheese()]));

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].cartQuantity).toBe(2);
      // Add-ons are billed per parent unit: (500 + 50) x 2.
      expect(result.current.subtotal).toBe(1100);
    });

    it("keeps the same product on separate lines when the toppings differ", () => {
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(burger(), [cheese()]));
      act(() => result.current.addToCart(burger()));

      expect(result.current.items).toHaveLength(2);
      expect(result.current.subtotal).toBe(1050);
    });

    it("ignores the order toppings were picked in", () => {
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(burger(), [cheese(), onions()]));
      act(() => result.current.addToCart(burger(), [onions(), cheese()]));

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].cartQuantity).toBe(2);
    });

    it("does not merge the same topping at a different typed price", () => {
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(burger(), [cheese({ priceMode: "PROMPT", unitPrice: 50 })]));
      act(() => result.current.addToCart(burger(), [cheese({ priceMode: "PROMPT", unitPrice: 80 })]));

      expect(result.current.items).toHaveLength(2);
    });

    it("separates lines that carry different kitchen notes", () => {
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(burger(), [], "no chilli"));
      act(() => result.current.addToCart(burger(), [], "extra spicy"));

      expect(result.current.items).toHaveLength(2);
      expect(result.current.items.map(i => i.notes)).toEqual(["no chilli", "extra spicy"]);
    });

    it("removes only the addressed line, leaving its sibling", () => {
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(burger(), [cheese()]));
      act(() => result.current.addToCart(burger()));
      act(() => result.current.removeFromCart(result.current.items[0].lineId));

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].toppings).toBeUndefined();
    });

    it("counts every line of a product against one stock ceiling", () => {
      // Two lines, one shared ceiling of 1: the second add must be refused even
      // though it is a different line key.
      const tracked = () => makeProduct({ id: "b1", stockQuantity: 1, trackStock: true });
      const { result } = renderHook(() => useCart());
      act(() => result.current.addToCart(tracked(), [cheese()]));
      act(() => result.current.addToCart(tracked()));

      expect(result.current.items).toHaveLength(1);
    });
  });
});

/**
 * `useCartTotals` was lifted out of `useCart` so a dine-in tab — whose lines
 * live on the server — can be totalled by the same arithmetic instead of a
 * third copy of the tax chain.
 *
 * The 25 tests above are the real regression proof: they are unchanged and they
 * exercise `useCart` end to end. These assert the lift itself was faithful, by
 * feeding `useCartTotals` the exact lines a retail cart holds and demanding the
 * same numbers out.
 */
describe("useCartTotals", () => {
  const taxContext: TaxContext = {
    taxRates: [
      { id: "t1", name: "VAT", rate: 0.15, isDefault: true, isActive: true },
      { id: "t2", name: "Food", rate: 0.08, isDefault: false, isActive: true },
    ] as TaxContext["taxRates"],
    categories: [{ id: "c1", name: "Food", taxRateId: "t2", createdAt: "" }],
  };

  const cheese = (): CartItemTopping => ({
    toppingId: "t-cheese",
    name: "Extra cheese",
    quantity: 1,
    unitPrice: 120,
    priceMode: "FIXED",
  });

  it("returns exactly what useCart returns for the same lines (exclusive tax)", () => {
    const product = makeProduct({ id: "b1", basePrice: 500, categoryId: "c1", trackStock: false });

    const cart = renderHook(() => useCart(taxContext, undefined, false));
    act(() => cart.result.current.addToCart(product, [cheese()]));
    act(() => cart.result.current.addToCart(product, [cheese()]));
    act(() => cart.result.current.setItemDiscount(cart.result.current.items[0].lineId, 50));

    const lines = cart.result.current.items;
    const totals = renderHook(() => useCartTotals(lines, taxContext, false));

    expect(totals.result.current.subtotal).toBe(cart.result.current.subtotal);
    expect(totals.result.current.discountAmount).toBe(cart.result.current.discountAmount);
    expect(totals.result.current.taxAmount).toBe(cart.result.current.taxAmount);
    expect(totals.result.current.taxLabel).toBe(cart.result.current.taxLabel);
    expect(totals.result.current.total).toBe(cart.result.current.total);
    expect(totals.result.current.itemCount).toBe(cart.result.current.itemCount);
  });

  it("returns exactly what useCart returns for the same lines (inclusive tax)", () => {
    const product = makeProduct({ id: "b1", basePrice: 1150, trackStock: false });

    const cart = renderHook(() => useCart(taxContext, undefined, true));
    act(() => cart.result.current.addToCart(product, [cheese()]));

    const totals = renderHook(() => useCartTotals(cart.result.current.items, taxContext, true));

    expect(totals.result.current.taxAmount).toBe(cart.result.current.taxAmount);
    expect(totals.result.current.total).toBe(cart.result.current.total);
    expect(totals.result.current.taxInclusive).toBe(true);
  });

  it("still rounds tax per sub-line, matching the backend's per-row rounding", () => {
    // Dish 100.10 + one add-on 0.55, at 15% exclusive. Rounding the dish and the
    // add-on separately gives 15.02 + 0.08 = 15.10; folding them into one base
    // first gives 15.10 too only by luck — the assertion is the per-row figure.
    const item: CartItem = {
      ...makeProduct({ id: "d1", basePrice: 100.1, trackStock: false }),
      lineId: "d1#",
      cartQuantity: 1,
      discountAmount: 0,
      toppings: [{ ...cheese(), unitPrice: 0.55 }],
    };
    const { result } = renderHook(() => useCartTotals([item], taxContext, false));

    const perRow =
      Math.round(100.1 * 0.15 * 100) / 100 + Math.round(0.55 * 0.15 * 100) / 100;
    expect(result.current.taxAmount).toBeCloseTo(perRow, 10);
  });

  it("is empty-safe, so a tab that has not been ordered on yet totals zero", () => {
    const { result } = renderHook(() => useCartTotals([], taxContext, false));
    expect(result.current.subtotal).toBe(0);
    expect(result.current.total).toBe(0);
    expect(result.current.itemCount).toBe(0);
  });
});
