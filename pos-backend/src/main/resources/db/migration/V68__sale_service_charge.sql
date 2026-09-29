-- Service charge on dine-in bills.
--
-- A dine-in tab is billed a percentage service charge (tenant setting, default
-- 10%) on its taxable value — every line after discount, before VAT — and VAT
-- is then charged on the service charge itself, as is normal in Sri Lanka.
--
-- The charge is written into the sale as a line of its own ("Service charge
-- (10%)", product_id NULL, the V49 custom-line shape), so tax, totals, the
-- receipt, the drawer's cash total and the tax report all see it with no
-- special case. These two columns are the record of it at sale level:
--
--   service_charge_amount  the charge before its VAT; 0 when none was billed.
--   service_charge_waived  the cashier removed it from this bill — kept so a
--                          manager can see how often, and by whom (created_by).
--
-- Only the server sets either: RestaurantOrderService.settle, for DINE_IN
-- orders. The sale request fields are not accepted from a client.

ALTER TABLE sales ADD COLUMN service_charge_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN service_charge_waived BOOLEAN NOT NULL DEFAULT FALSE;
