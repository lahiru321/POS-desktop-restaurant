import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { login, loginAsCashier } from "./helpers/login";
import { resetCashierShift } from "./helpers/cash-session-setup";
import { API_URL, TERMINAL_USER, TEST_USER } from "./fixtures/test-credentials";

/**
 * The restaurant flow end to end, in a real browser against a running stack:
 *
 *   seat a table → dish with an add-on → Send (round 1) → the same dish again →
 *   Send (round 2, carrying ONLY the new unit) → settle → table free again.
 *   And a takeaway: pay at the counter → the kitchen ticket fires on payment.
 *
 * Kitchen printing is off on a fresh browser profile, so every ticket takes the
 * "no kitchen printer here" path: recorded server-side and acknowledged
 * HANDLED. That is exactly what lets the test assert the ticket contents
 * through the API without a physical printer.
 *
 * Setup (see e2e/README.md): backend at PLAYWRIGHT_API_URL, frontend at
 * PLAYWRIGHT_BASE_URL, the seeded demo admin and cashier. Everything the test
 * needs on the menu and the floor it creates itself, under a unique run id.
 */

const V1 = `${API_URL}/api/v1`;
const RUN = Date.now().toString(36).slice(-5);
const TABLE = `E2E-${RUN}`;
const TABLE2 = `E2F-${RUN}`;
const DISH = `E2E Kottu ${RUN}`;
const ADDON = `Extra cheese ${RUN}`;

let adminToken = "";
let dishId = "";
let table2Id = "";
let addonId = "";

async function adminLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${V1}/auth/login`, {
    data: { email: TERMINAL_USER.email, password: TERMINAL_USER.password },
  });
  const body = await res.json();
  if (!res.ok() || !body?.success) throw new Error(`Admin login failed: ${body?.message ?? res.status()}`);
  return body.data.accessToken;
}

async function api<T>(request: APIRequestContext, method: "get" | "post" | "put", path: string, data?: unknown): Promise<T> {
  const res = await request[method](`${V1}${path}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} → ${res.status()}: ${body?.message ?? ""}`);
  return body.data as T;
}

type Ticket = {
  label: string;
  ticketType: string;
  notice?: string | null;
  status: string;
  lastError?: string | null;
  items: { itemName: string; quantity: number; modifiers: string[] }[];
};

async function ticketsFor(request: APIRequestContext, orderId: string): Promise<Ticket[]> {
  return api<Ticket[]>(request, "get", `/restaurant/kitchen-tickets?orderId=${orderId}`);
}

async function openShift(page: Page) {
  await loginAsCashier(page);
  await page.goto("/terminal");
  const startModal = page.getByRole("dialog", { name: /start your shift/i });
  await expect(startModal).toBeVisible();
  await startModal.getByLabel(/opening cash/i).fill("100");
  await startModal.getByRole("button", { name: /start shift/i }).click();
  await expect(startModal).toBeHidden();
}

/** Taps the dish, ticks the add-on in the picker, adds it. */
async function addDishWithAddon(page: Page) {
  await page.locator("[data-product-card]", { hasText: DISH }).first().click();
  const picker = page.getByRole("dialog", { name: DISH });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: new RegExp(ADDON) }).click();
  await picker.getByRole("button", { name: /^add/i }).click();
  await expect(picker).toBeHidden();
}

async function payExactCash(page: Page) {
  await page.getByRole("radio", { name: /cash/i }).click();
  await page.getByRole("button", { name: /^exact$/i }).click();
  await page.getByRole("button", { name: /complete sale/i }).click();
}

test.describe("restaurant — tables, kitchen rounds, takeaway", () => {
  test.beforeAll(async ({ request }) => {
    adminToken = await adminLogin(request);

    const area = await api<{ id: string }>(request, "post", "/restaurant/areas", {
      name: `E2E ${RUN}`,
      sortOrder: 99,
      isActive: true,
    });
    await api(request, "post", "/restaurant/tables", {
      areaId: area.id,
      name: TABLE,
      seats: 2,
      isActive: true,
    });
    const second = await api<{ id: string }>(request, "post", "/restaurant/tables", {
      areaId: area.id,
      name: TABLE2,
      seats: 4,
      isActive: true,
    });
    table2Id = second.id;

    const dish = await api<{ id: string }>(request, "post", "/products", {
      name: DISH,
      basePrice: 950,
      stockQuantity: 0,
      lowStockThreshold: 0,
      trackStock: false,
      isActive: true,
    });
    dishId = dish.id;

    const group = await api<{ id: string }>(request, "post", "/restaurant/topping-groups", {
      name: `Extras ${RUN}`,
      selectionMode: "MULTI",
      minSelect: 0,
      isActive: true,
    });
    const addon = await api<{ id: string }>(request, "post", "/restaurant/toppings", {
      groupId: group.id,
      name: ADDON,
      priceMode: "FIXED",
      defaultPrice: 150,
      isActive: true,
    });
    addonId = addon.id;
    await api(request, "put", `/restaurant/products/${dishId}/topping-groups`, [group.id]);
  });

  test.beforeEach(async ({ request }) => {
    await resetCashierShift(request);
  });

  test.afterEach(async ({ request }) => {
    await resetCashierShift(request);
  });

  test("a second round prints only what was added, and settling frees the table", async ({ page, request }) => {
    await openShift(page);

    // ── Seat the table from the floor sheet (F11) ────────────────────────
    await page.keyboard.press("F11");
    await page.getByRole("tab", { name: new RegExp(`E2E ${RUN}`) }).click();
    await page.getByRole("button", { name: new RegExp(`^${TABLE}, 2 seats, available`) }).click();
    await expect(page.getByText(new RegExp(`Order \\d+ · ${TABLE}`)).first()).toBeVisible();

    // ── Round 1: the dish with its add-on ────────────────────────────────
    await addDishWithAddon(page);
    await page.getByRole("button", { name: /^send \(1\)/i }).click();
    await expect(page.getByText(/-R1 recorded — tell the kitchen/)).toBeVisible();

    // ── Round 2: one more of the same dish ───────────────────────────────
    await addDishWithAddon(page);
    await page.keyboard.press("F5");
    await expect(page.getByText(/-R2 recorded — tell the kitchen/)).toBeVisible();

    const open = await api<{ id: string; label: string; tableName: string }[]>(request, "get", "/restaurant/orders");
    const order = open.find((o) => o.tableName === TABLE);
    expect(order, "the table has an open tab").toBeTruthy();

    const tickets = await ticketsFor(request, order!.id);
    expect(tickets).toHaveLength(2);
    expect(tickets[0].items.map((i) => [i.itemName, i.quantity, i.modifiers])).toEqual([[DISH, 1, [ADDON]]]);
    // The second round is the delta: one unit, not the line's running total of two.
    expect(tickets[1].items.map((i) => [i.itemName, i.quantity])).toEqual([[DISH, 1]]);
    // No printer on a fresh profile: recorded and handled, never left pending.
    for (const t of tickets) {
      expect(t.status).toBe("PRINTED");
      expect(t.lastError).toMatch(/no kitchen printer/i);
    }

    // ── Settle ───────────────────────────────────────────────────────────
    await page.getByRole("button", { name: /^settle/i }).click();
    await payExactCash(page);
    await expect(page.getByText(new RegExp(`${order!.label} paid`))).toBeVisible();

    const stillOpen = await api<{ tableName: string }[]>(request, "get", "/restaurant/orders");
    expect(stillOpen.some((o) => o.tableName === TABLE)).toBe(false);
    // A dine-in settle sends nothing further to the kitchen.
    expect(await ticketsFor(request, order!.id)).toHaveLength(2);
  });

  test("moving a tab tells the kitchen; merging makes one bill without re-sending", async ({ page, request }) => {
    await openShift(page);

    // Seat TABLE, send one dish.
    await page.keyboard.press("F11");
    await page.getByRole("tab", { name: new RegExp(`E2E ${RUN}`) }).click();
    await page.getByRole("button", { name: new RegExp(`^${TABLE}, 2 seats, available`) }).click();
    await addDishWithAddon(page);
    await page.getByRole("button", { name: /^send \(1\)/i }).click();
    await expect(page.getByText(/-R1 recorded — tell the kitchen/)).toBeVisible();

    // ── Move to TABLE2: the kitchen gets a MOVE slip ─────────────────────
    await page.getByRole("button", { name: /^move$/i }).click();
    await page.getByRole("tab", { name: new RegExp(`E2E ${RUN}`) }).click();
    await page.getByRole("button", { name: new RegExp(`^${TABLE2}, 4 seats, available`) }).click();
    await expect(page.getByText(new RegExp(`Order \\d+ · ${TABLE2} — moved`))).toBeVisible();
    await expect(page.getByText(/-R2-MOVE recorded — tell the kitchen/)).toBeVisible();

    const afterMove = await api<{ id: string; tableName: string }[]>(request, "get", "/restaurant/orders");
    const moved = afterMove.find((o) => o.tableName === TABLE2)!;
    expect(moved, "the tab is now on the second table").toBeTruthy();
    expect(afterMove.some((o) => o.tableName === TABLE)).toBe(false);
    const moveTicket = (await ticketsFor(request, moved.id)).at(-1)!;
    expect(moveTicket).toMatchObject({ ticketType: "MOVE", notice: `MOVED FROM ${TABLE}`, items: [] });

    // ── Another party sits at TABLE; then this tab merges into theirs ────
    const tables = await api<{ id: string; name: string }[]>(request, "get", "/restaurant/tables");
    const other = await api<{ id: string; label: string }>(request, "post", "/restaurant/orders", {
      tableId: tables.find((t) => t.name === TABLE)!.id,
      covers: 2,
      items: [{ productId: dishId, quantity: 1 }],
    });

    await page.getByRole("button", { name: /^move$/i }).click();
    await page.getByRole("tab", { name: new RegExp(`E2E ${RUN}`) }).click();
    await page.getByRole("button", { name: new RegExp(`^${TABLE}, occupied`) }).click();
    await page.getByRole("button", { name: /^merge tabs$/i }).click();
    await expect(page.getByText(`Merged into ${other.label}`)).toBeVisible();

    const afterMerge = await api<{ id: string; tableName: string; covers: number; items: unknown[] }[]>(
      request, "get", "/restaurant/orders");
    expect(afterMerge.some((o) => o.tableName === TABLE2)).toBe(false);
    const merged = afterMerge.find((o) => o.id === other.id)!;
    expect(merged.items).toHaveLength(2);
    expect(merged.covers).toBe(4);
    // The merged-in dish was already cooking: one MOVE slip, and nothing re-fired.
    const mergedTickets = await ticketsFor(request, merged.id);
    expect(mergedTickets.map((t) => t.ticketType)).toEqual(["MOVE"]);

    // Tidy: settle the merged bill so the tables are free for the next test.
    await page.getByRole("button", { name: /^settle/i }).click();
    await payExactCash(page);
    await expect(page.getByText(new RegExp(`${other.label} paid`))).toBeVisible();
  });

  test("a parked sale waits on the floor, then fires the kitchen when paid", async ({ page, request }) => {
    await openShift(page);

    // Park the counter cart: nothing reaches the kitchen yet.
    await page.getByRole("radio", { name: "Counter" }).click();
    await addDishWithAddon(page);
    await page.getByRole("button", { name: /^park$/i }).click();
    const parked = page.getByText(/Parked as Order (\d+) · Takeaway/);
    await expect(parked).toBeVisible();
    const number = Number((await parked.innerText()).match(/Order (\d+)/)![1]);

    const open = await api<{ id: string; orderNumber: number; orderType: string }[]>(request, "get", "/restaurant/orders");
    const order = open.find((o) => o.orderType === "TAKEAWAY" && o.orderNumber === number);
    expect(order, "the parked order is open").toBeTruthy();
    expect(await ticketsFor(request, order!.id)).toHaveLength(0);

    // Pick it up from the floor's Takeaway tab and pay.
    await page.keyboard.press("F11");
    await page.getByRole("tab", { name: /takeaway/i }).click();
    await page.getByRole("button", { name: new RegExp(`Order ${number} · Takeaway, parked`) }).click();
    await expect(page.getByText(`Order ${number} · Takeaway`).first()).toBeVisible();

    await page.getByRole("button", { name: /^settle/i }).click();
    await payExactCash(page);
    await expect(page.getByText(new RegExp(`Order ${number} · Takeaway paid`))).toBeVisible();

    // Takeaway pays, then fires: exactly one round, carrying the parked dish.
    const tickets = await ticketsFor(request, order!.id);
    expect(tickets.map((t) => t.items.map((i) => [i.itemName, i.quantity]))).toEqual([[[DISH, 1]]]);
  });

  test("a takeaway is paid at the counter, then fires the kitchen", async ({ page, request }) => {
    await openShift(page);

    await page.getByRole("radio", { name: "Takeaway" }).click();
    await addDishWithAddon(page);
    await page.getByRole("button", { name: /charge & send/i }).click();
    await payExactCash(page);

    const paid = page.getByText(/Order (\d+) · Takeaway paid/);
    await expect(paid).toBeVisible();
    await expect(page.getByText(/-R1 recorded — tell the kitchen/)).toBeVisible();

    // The ticket was fired by the same transaction as the sale.
    const label = (await paid.innerText()).match(/Order (\d+) · Takeaway/)![0];
    const number = Number(label.match(/\d+/)![0]);
    const unresolved = await api<Ticket[]>(request, "get", "/restaurant/kitchen-tickets");
    expect(unresolved.some((t) => t.label.startsWith(`#${String(number).padStart(4, "0")}`))).toBe(false);
  });

  test("returning a dish refunds its add-on with it", async ({ page, request }) => {
    // Other tests in this run sell the same add-on, so the report is compared
    // before and after rather than against absolute figures.
    const day = new Date().toLocaleDateString("en-CA"); // yyyy-MM-dd, local
    type AddonRow = { name: string; portionsSold: number; revenue: number;
      portionsReturned: number; refunded: number; netRevenue: number };
    const addonRow = async (): Promise<AddonRow> => {
      const report = await api<{ toppings: AddonRow[] }>(
        request, "get", `/reports/topping-sales?start=${day}T00:00:00&end=${day}T23:59:59`);
      return report.toppings.find((t) => t.name === ADDON) ??
        { name: ADDON, portionsSold: 0, revenue: 0, portionsReturned: 0, refunded: 0, netRevenue: 0 };
    };
    const before = await addonRow();

    // A paid sale of 2 dishes with the add-on, rung by the cashier on a fresh shift.
    const cashier = await request.post(`${V1}/auth/login`, {
      data: { email: TEST_USER.email, password: TEST_USER.password },
    });
    const cashierToken = (await cashier.json()).data.accessToken as string;
    const headers = { Authorization: `Bearer ${cashierToken}` };
    await request.post(`${V1}/cash-session/start`, { headers, data: { openingBalance: 100 } });
    const saleRes = await request.post(`${V1}/sales`, {
      headers,
      data: {
        paymentMethod: "CASH",
        items: [{ productId: dishId, quantity: 2, unitPrice: 950, discountAmount: 0,
                  toppings: [{ toppingId: addonId, quantity: 1 }] }],
      },
    });
    const sale = (await saleRes.json()).data as { id: string; invoiceNumber: string };
    expect(sale?.id, "the sale was created").toBeTruthy();

    // Return one dish from Reports; its add-on follows it.
    await login(page, TERMINAL_USER);
    await page.goto("/reports");
    const row = page.getByRole("row", { name: new RegExp(sale.invoiceNumber) });
    await row.getByRole("button", { name: /return/i }).click();

    const modal = page.getByRole("dialog", { name: /process return/i });
    await expect(modal).toBeVisible();
    await modal.getByLabel(`Return quantity for ${DISH}`).fill("1");
    await expect(modal.getByText("1 with dish")).toBeVisible();
    await modal.locator("select").nth(1).selectOption("Customer Changed Mind");
    await modal.getByRole("button", { name: /process return/i }).click();
    await expect(page.getByText(/return (processed|submitted)/i)).toBeVisible();

    const returns = await api<{ id: string; status: string; refundAmount: number;
      items: { productName: string; quantityReturned: number }[] }[]>(
      request, "get", `/returns/sale/${sale.id}`);
    expect(returns).toHaveLength(1);
    // 1 dish (950) + its 1 cheese portion (150).
    expect(returns[0].refundAmount).toBeCloseTo(1100, 2);
    expect(returns[0].items.map((i) => [i.productName, i.quantityReturned])).toEqual([
      [DISH, 1],
      [ADDON, 1],
    ]);

    // Over the auto-approve limit, so a manager approves it; only a completed
    // refund counts against revenue.
    if (returns[0].status === "PENDING") {
      await api(request, "put", `/returns/${returns[0].id}/approve?approve=true`);
    }

    // The add-on report counts both the sale and the refund.
    const after = await addonRow();
    expect({
      sold: after.portionsSold - before.portionsSold,
      revenue: after.revenue - before.revenue,
      returned: after.portionsReturned - before.portionsReturned,
      refunded: after.refunded - before.refunded,
    }).toEqual({ sold: 2, revenue: 300, returned: 1, refunded: 150 });
    await page.getByRole("tab", { name: /add-ons/i }).click();
    await expect(page.getByRole("row", { name: new RegExp(ADDON) })).toBeVisible();
  });

  test("a split bill pays for part of the tab and leaves the rest open", async ({ page, request }) => {
    await openShift(page);

    await page.keyboard.press("F11");
    await page.getByRole("tab", { name: new RegExp(`E2E ${RUN}`) }).click();
    await page.getByRole("button", { name: new RegExp(`^${TABLE}, 2 seats, available`) }).click();
    await addDishWithAddon(page);
    await addDishWithAddon(page);
    await expect(page.getByRole("button", { name: /^split$/i })).toBeVisible();

    // One guest pays for one of the two dishes.
    await page.getByRole("button", { name: /^split$/i }).click();
    const dialog = page.getByRole("dialog", { name: /split the bill/i });
    await dialog.getByRole("button", { name: `One more ${DISH}` }).click();
    await dialog.getByRole("button", { name: /pay for these/i }).click();
    await expect(page.getByText(/paying for part of the tab/i)).toBeVisible();
    await payExactCash(page);
    await expect(page.getByText(/Order \d+ · Split bill paid/)).toBeVisible();

    // The other dish is still on the table's tab.
    const open = await api<{ tableName: string; items: { itemName: string; billableQuantity: number }[] }[]>(
      request, "get", "/restaurant/orders");
    const tab = open.find((o) => o.tableName === TABLE)!;
    expect(tab, "the tab is still open").toBeTruthy();
    expect(tab.items.map((i) => [i.itemName, i.billableQuantity])).toEqual([[DISH, 1]]);

    // Tidy: settle what is left.
    await page.getByRole("button", { name: /^settle/i }).click();
    await payExactCash(page);
    await expect(page.getByText(new RegExp(`Order \\d+ · ${TABLE} paid`))).toBeVisible();
  });

  test("a dine-in bill carries the service charge, and it can be removed", async ({ page, request }) => {
    await openShift(page);

    const seatAndSettle = async (removeCharge: boolean): Promise<number> => {
      await page.keyboard.press("F11");
      await page.getByRole("tab", { name: new RegExp(`E2E ${RUN}`) }).click();
      await page.getByRole("button", { name: new RegExp(`^${TABLE}, 2 seats, available`) }).click();
      await addDishWithAddon(page);
      await page.getByRole("button", { name: /^settle/i }).click();
      await expect(page.getByText(/^Service charge 10%/)).toBeVisible();
      if (removeCharge) {
        await page.getByRole("button", { name: /^remove$/i }).click();
        await expect(page.getByText("Service charge removed")).toBeVisible();
      }
      await page.getByRole("radio", { name: /cash/i }).click();
      await page.getByRole("button", { name: /^exact$/i }).click();
      const complete = page.getByRole("button", { name: /complete sale/i });
      // "Complete sale, total Rs. 1210.00": take the amount, not the "." in "Rs.".
      const label = (await complete.getAttribute("aria-label")) ?? "";
      const shown = Number(label.match(/(\d[\d,]*\.\d{2})\s*$/)![1].replace(/,/g, ""));
      await complete.click();
      await expect(page.getByText(new RegExp(`Order \\d+ · ${TABLE} paid`))).toBeVisible();
      return shown;
    };

    const shownWith = await seatAndSettle(false);
    const shownWithout = await seatAndSettle(true);

    // What the till showed is exactly what the server billed, both times.
    const cashier = await request.post(`${V1}/auth/login`, {
      data: { email: TEST_USER.email, password: TEST_USER.password },
    });
    const headers = { Authorization: `Bearer ${(await cashier.json()).data.accessToken}` };
    const sales = (await (await request.get(`${V1}/sales/session/current`, { headers })).json()).data as {
      netAmount: number; serviceChargeAmount: number; serviceChargeWaived: boolean;
      items: { productName: string; totalAmount: number }[];
    }[];
    const [without, withCharge] = sales; // newest first

    expect(withCharge.serviceChargeAmount).toBeGreaterThan(0);
    expect(withCharge.serviceChargeWaived).toBe(false);
    expect(withCharge.items.some((i) => i.productName === "Service charge (10%)")).toBe(true);
    expect(withCharge.netAmount).toBeCloseTo(shownWith, 2);

    expect(without.serviceChargeAmount).toBe(0);
    expect(without.serviceChargeWaived).toBe(true);
    expect(without.items.some((i) => i.productName?.startsWith("Service charge"))).toBe(false);
    expect(without.netAmount).toBeCloseTo(shownWithout, 2);
    expect(withCharge.netAmount).toBeGreaterThan(without.netAmount);
  });
});
