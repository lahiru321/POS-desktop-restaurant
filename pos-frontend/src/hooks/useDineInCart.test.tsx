import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useDineInCart } from "./useDineInCart";
import type { TaxContext } from "./useCart";
import type { Product } from "@/types/inventory";
import type {
  OrderItemResponse,
  RestaurantOrder,
} from "@/services/restaurantOrderService";

vi.mock("@/services/restaurantOrderService", () => ({
  restaurantOrderService: {
    getOrder: vi.fn(),
    addItems: vi.fn(),
    updateItem: vi.fn(),
    voidItem: vi.fn(),
  },
}));

vi.mock("@/services/inventoryService", () => ({
  inventoryService: { getProducts: vi.fn() },
}));

import { restaurantOrderService } from "@/services/restaurantOrderService";
import { inventoryService } from "@/services/inventoryService";

const getOrder = vi.mocked(restaurantOrderService.getOrder);
const addItems = vi.mocked(restaurantOrderService.addItems);
const updateItem = vi.mocked(restaurantOrderService.updateItem);
const voidItem = vi.mocked(restaurantOrderService.voidItem);
const getProducts = vi.mocked(inventoryService.getProducts);

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Chicken Kottu",
    sku: "K-001",
    basePrice: 500,
    stockQuantity: 0,
    lowStockThreshold: 0,
    isActive: true,
    trackStock: false, // made to order, as most of a menu is
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function makeLine(overrides: Partial<OrderItemResponse> = {}): OrderItemResponse {
  return {
    id: "i1",
    productId: "p1",
    itemName: "Chicken Kottu",
    quantity: 2,
    firedQuantity: 0,
    voidedQuantity: 0,
    billableQuantity: 2,
    unitPriceSnapshot: 500,
    discountAmount: 0,
    notes: null,
    courseNo: 1,
    sortOrder: 0,
    toppings: [],
    ...overrides,
  };
}

function makeOrder(overrides: Partial<RestaurantOrder> = {}): RestaurantOrder {
  return {
    id: "o1",
    orderNumber: 14,
    label: "Order 14 · T1",
    businessDate: "2026-09-21",
    orderType: "DINE_IN",
    status: "OPEN",
    branchId: "b1",
    tableId: "tb1",
    tableName: "T1",
    customerId: null,
    covers: 4,
    openedBy: "u1",
    servedBy: "u1",
    saleId: null,
    roundCount: 0,
    openedAt: "2026-09-21T13:00:00+05:30",
    settledAt: null,
    runningTotal: 1000,
    items: [makeLine()],
    ...overrides,
  };
}

const taxContext: TaxContext = {
  taxRates: [{ id: "t1", name: "VAT", rate: 0.15, isDefault: true, isActive: true }],
  categories: [],
} as unknown as TaxContext;

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mount(options: Partial<Parameters<typeof useDineInCart>[0]> = {}) {
  return renderHook(
    () =>
      useDineInCart({
        orderId: "o1",
        enabled: true,
        taxContext,
        taxInclusive: false,
        branchId: "b1",
        ...options,
      }),
    { wrapper }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getProducts.mockResolvedValue({
    content: [makeProduct()],
  } as unknown as Awaited<ReturnType<typeof inventoryService.getProducts>>);
});

describe("useDineInCart", () => {
  it("issues no requests at all when restaurant mode is off", async () => {
    getOrder.mockResolvedValue(makeOrder());
    const { result } = mount({ enabled: false });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getOrder).not.toHaveBeenCalled();
    expect(getProducts).not.toHaveBeenCalled();
    expect(result.current.items).toHaveLength(0);
    expect(result.current.order).toBeUndefined();
  });

  it("renders the tab's lines as cart lines keyed by the SERVER's line id", async () => {
    getOrder.mockResolvedValue(makeOrder());
    const { result } = mount();

    await waitFor(() => expect(result.current.items).toHaveLength(1));

    const line = result.current.items[0];
    expect(line.lineId).toBe("i1");
    expect(line.id).toBe("p1");
    expect(line.name).toBe("Chicken Kottu");
    expect(line.cartQuantity).toBe(2);
    expect(line.basePrice).toBe(500);
    expect(result.current.subtotal).toBe(1000);
  });

  it("hides a fully-voided line, because the bill will not charge for it", async () => {
    getOrder.mockResolvedValue(
      makeOrder({
        items: [
          makeLine(),
          makeLine({ id: "i2", quantity: 1, voidedQuantity: 1, billableQuantity: 0 }),
        ],
      })
    );
    const { result } = mount();

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].lineId).toBe("i1");
  });

  it("merges a repeat tap onto the existing line instead of growing a duplicate row", async () => {
    getOrder.mockResolvedValue(makeOrder());
    updateItem.mockResolvedValue(makeOrder());
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.addToCart(makeProduct()));

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1));
    expect(updateItem).toHaveBeenCalledWith("o1", "i1", { quantity: 3 });
    expect(addItems).not.toHaveBeenCalled();
  });

  it("posts a new line when the add-ons differ, exactly as the cart key does", async () => {
    getOrder.mockResolvedValue(makeOrder());
    addItems.mockResolvedValue(makeOrder());
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() =>
      result.current.addToCart(makeProduct(), [
        {
          toppingId: "t-cheese",
          name: "Extra cheese",
          quantity: 1,
          unitPrice: 120,
          priceMode: "FIXED",
        },
      ])
    );

    await waitFor(() => expect(addItems).toHaveBeenCalledTimes(1));
    expect(updateItem).not.toHaveBeenCalled();
    const [, body] = addItems.mock.calls[0];
    expect(body.items[0].productId).toBe("p1");
    // A FIXED add-on sends no price — the server bills its own figure.
    expect(body.items[0].toppings?.[0]).toEqual({
      toppingId: "t-cheese",
      quantity: 1,
      unitPrice: undefined,
    });
  });

  it("removing a line voids it server-side rather than deleting anything locally", async () => {
    getOrder.mockResolvedValue(makeOrder());
    voidItem.mockResolvedValue(makeOrder());
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.removeFromCart("i1"));

    await waitFor(() => expect(voidItem).toHaveBeenCalledWith("o1", "i1"));
  });

  it("taking a line to zero is a void, not a quantity update", async () => {
    getOrder.mockResolvedValue(makeOrder());
    voidItem.mockResolvedValue(makeOrder());
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.updateQuantity("i1", 0));

    await waitFor(() => expect(voidItem).toHaveBeenCalledWith("o1", "i1"));
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("patches the quantity when it goes up", async () => {
    getOrder.mockResolvedValue(makeOrder());
    updateItem.mockResolvedValue(makeOrder());
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.updateQuantity("i1", 5));

    await waitFor(() => expect(updateItem).toHaveBeenCalledWith("o1", "i1", { quantity: 5 }));
  });

  it("warns before settle about a line the menu has re-priced under the tab", async () => {
    getOrder.mockResolvedValue(makeOrder());
    getProducts.mockResolvedValue({
      content: [makeProduct({ basePrice: 550 })],
    } as unknown as Awaited<ReturnType<typeof inventoryService.getProducts>>);
    const { result } = mount();

    await waitFor(() => expect(result.current.repricedPreview).toHaveLength(1));
    expect(result.current.repricedPreview[0]).toEqual({
      itemName: "Chicken Kottu",
      orderedPrice: 500,
      billedPrice: 550,
    });
  });

  it("reports nothing re-priced when the menu has not moved", async () => {
    getOrder.mockResolvedValue(makeOrder());
    const { result } = mount();

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.repricedPreview).toHaveLength(0);
  });

  it("treats a settled tab as closed and holds no lines", async () => {
    getOrder.mockResolvedValue(makeOrder({ status: "SETTLED", saleId: "s1" }));
    const { result } = mount();

    await waitFor(() => expect(result.current.isClosed).toBe(true));
    expect(result.current.order).toBeUndefined();
    expect(result.current.items).toHaveLength(0);
  });

  it("enforces the branch stock ceiling for a TRACKED product", async () => {
    getOrder.mockResolvedValue(makeOrder());
    const bottled = makeProduct({
      id: "p1",
      trackStock: true,
      stockQuantity: 2,
      stockLevels: [
        { id: "sl1", productId: "p1", branchId: "b1", branchName: "Main", quantity: 2 },
      ],
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    // The tab already carries 2 of them, which is the whole branch ceiling.
    act(() => result.current.addToCart(bottled));

    await act(async () => {
      await Promise.resolve();
    });
    expect(addItems).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("does not apply a stock ceiling to a made-to-order dish", async () => {
    // `stockQuantity` is a server-side SUM that reads 0 when nothing is tracked,
    // so the guard has to key off the flag or a restaurant cannot sell anything.
    getOrder.mockResolvedValue(makeOrder());
    updateItem.mockResolvedValue(makeOrder());
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.addToCart(makeProduct({ stockQuantity: 0, trackStock: false })));

    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1));
  });

  it("adds a custom/open line with its typed price", async () => {
    getOrder.mockResolvedValue(makeOrder());
    addItems.mockResolvedValue(makeOrder());
    const { result } = mount();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.addCustomItem("Birthday cake slice", 450, 2));

    await waitFor(() => expect(addItems).toHaveBeenCalledTimes(1));
    expect(addItems.mock.calls[0][1].items[0]).toEqual({
      itemName: "Birthday cake slice",
      quantity: 2,
      unitPrice: 450,
    });
  });
});
