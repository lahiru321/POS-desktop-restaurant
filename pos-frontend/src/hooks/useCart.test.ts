import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCart } from "./useCart";
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
    act(() => result.current.removeFromCart("p1"));
    expect(result.current.items).toHaveLength(0);
  });

  it("updateQuantity to 0 removes the item", () => {
    const { result } = renderHook(() => useCart());
    act(() => result.current.addToCart(makeProduct()));
    act(() => result.current.updateQuantity("p1", 0));
    expect(result.current.items).toHaveLength(0);
  });

  it("updateQuantity above stock keeps prior quantity", () => {
    const product = makeProduct({ stockQuantity: 3 });
    const { result } = renderHook(() => useCart());
    act(() => result.current.addToCart(product));
    act(() => result.current.updateQuantity("p1", 99));
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
      act(() => result.current.updateQuantity("food-1", 40));

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
});
