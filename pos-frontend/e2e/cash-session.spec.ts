import { test, expect } from "@playwright/test";
import { loginAsCashier } from "./helpers/login";
import { resetCashierShift, parseMoney } from "./helpers/cash-session-setup";

/**
 * Lumora's most delicate flow: open drawer → ring up cash sale → close drawer
 * with matching variance. If this is silently broken, an honest cashier looks
 * dishonest. This test is the safety net.
 *
 * Setup expectations (see e2e/README.md):
 *   - Backend reachable at PLAYWRIGHT_API_URL (default http://localhost:8082)
 *   - Frontend reachable at PLAYWRIGHT_BASE_URL (default http://localhost:3000)
 *   - The seeded cashier exists (migration V42 / fixtures/test-credentials.ts)
 *   - At least one active, in-stock product on the cashier's branch
 *
 * The test is currency- and price-agnostic: it reads the chosen product's price
 * from the card's data-price attribute and reconciles the drawer against the
 * "Expected" figure the End Shift modal computes, rather than hard-coding values.
 */
const OPEN_BAL = 200;

test.describe("cash session — open / sell / close", () => {
  // A prior failed run can leave an OPEN session, which suppresses the Start
  // Shift gate. Close it via the API first so every run starts from clean state.
  test.beforeEach(async ({ request }) => {
    await resetCashierShift(request);
  });

  test("variance is $0 when counted matches expected", async ({ page }) => {
    await loginAsCashier(page);
    await page.waitForURL(/\/terminal/);

    // ── 1. Open shift ────────────────────────────────────────────────────
    const startModal = page.getByRole("dialog", { name: /start your shift/i });
    await expect(startModal).toBeVisible();

    await startModal.getByLabel(/opening cash/i).fill(String(OPEN_BAL));
    await startModal.getByRole("button", { name: /start shift/i }).click();
    await expect(startModal).toBeHidden();

    // ── 2. Ring up the first available product ───────────────────────────
    // ProductGrid tags each card with data-product-card + data-price, and marks
    // out-of-stock / at-limit cards data-disabled="true".
    const productCard = page.locator('[data-product-card][data-disabled="false"]').first();
    await expect(productCard).toBeVisible();
    const price = parseMoney((await productCard.getAttribute("data-price")) ?? "0");
    expect(price).toBeGreaterThan(0);
    await productCard.click();

    // ── 3. Charge → tender overlay → CASH, exact tender, complete ────────
    // Payment now lives in a full-screen tender overlay opened from the cart's
    // Charge button (or F9). CASH is the default method there.
    await page.getByRole("button", { name: /charge/i }).click();
    await page.getByRole("radio", { name: /cash/i }).click();
    await page.getByRole("button", { name: /^exact$/i }).click();
    await page.getByRole("button", { name: /complete sale/i }).click();

    // Confirmation surfaces as a sonner toast ("Sale Processed: INV-…").
    await expect(page.getByText(/sale processed/i)).toBeVisible();

    // ── 4. End shift, assert variance = $0 ───────────────────────────────
    // The terminal header hosts the End Shift control (TimeClockWidget in
    // cash-drawer mode). Starting the shift clocked the cashier in, so it's now
    // showing "End Shift" rather than "Clock In".
    await page.getByRole("button", { name: /end shift/i }).click();

    const endModal = page.getByRole("dialog", { name: /end shift/i });
    await expect(endModal).toBeVisible();

    // The cash sale must have registered in the drawer's expected balance. The
    // active-session query refetches after the sale invalidation, so poll until
    // the cash-sales figure reflects the sale rather than the pre-sale snapshot.
    await expect
      .poll(async () => parseMoney(await endModal.getByTestId("end-shift-cash-sales").innerText()))
      .toBeGreaterThan(0);

    const cashSales = parseMoney(await endModal.getByTestId("end-shift-cash-sales").innerText());
    const expectedDrawer = parseMoney(await endModal.getByTestId("end-shift-expected").innerText());
    // Expected = opening float + cash sales (no refunds in this flow).
    expect(Math.abs(expectedDrawer - (OPEN_BAL + cashSales))).toBeLessThan(0.01);

    // Count exactly the expected amount → zero variance.
    await endModal.getByLabel(/counted cash/i).fill(String(expectedDrawer));
    await expect(endModal.getByText(/balances exactly/i)).toBeVisible();

    await endModal.getByRole("button", { name: /end shift/i }).click();

    // Success path raises a "drawer balanced" toast.
    await expect(page.getByText(/drawer balanced/i)).toBeVisible();
  });
});
