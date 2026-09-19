-- Per-product stock tracking switch.
--
-- Until now every catalogued product needed a stock_levels row at the branch being
-- sold from. SaleService.createSale throws "Stock record not found" when one is
-- missing, "Insufficient stock" when it runs dry, and rejects fractional quantities
-- outright because stock_levels.quantity is an INTEGER and .intValue() truncation
-- would silently deduct the wrong amount.
--
-- All three rules are correct for a packet of biscuits and wrong for a dish cooked
-- to order from ingredients. track_stock = FALSE opts a product out of the lookup,
-- the deduction, the shortage check and the integer-quantity rule, while leaving
-- pricing, tax, cost-price COGS and every report exactly as they are.
--
-- Backfilled TRUE for every existing row: today's behaviour is "always tracked",
-- and anything already in the catalogue must keep deducting. Only a product the
-- operator explicitly switches off changes behaviour.
--
-- Note that products.stock_quantity is not a column — it is a Hibernate @Formula
-- summing stock_levels — so an untracked product with no stock row reports 0.
-- Callers must branch on track_stock, never on that number.

ALTER TABLE products ADD COLUMN track_stock BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN products.track_stock IS
    'FALSE = sellable with no stock_levels row: no deduction, no shortage check, fractional quantities allowed.';
