import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { loginAsCashier } from "./helpers/login";
import { resetCashierShift } from "./helpers/cash-session-setup";
import { API_URL, TERMINAL_USER } from "./fixtures/test-credentials";

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
const DISH = `E2E Kottu ${RUN}`;
const ADDON = `Extra cheese ${RUN}`;

let adminToken = "";
let dishId = "";

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
    await api(request, "post", "/restaurant/toppings", {
      groupId: group.id,
      name: ADDON,
      priceMode: "FIXED",
      defaultPrice: 150,
      isActive: true,
    });
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
});
