-- Split bills: paying for part of a tab.
--
-- "I'll pay for my kottu and the juice, they'll pay for the rest." The chosen
-- quantities move off the tab onto an order of their own, which is settled on
-- the spot through the unmodified createSale — so each payer gets a proper sale,
-- on the drawer of whoever took their money. The rest stays open on the table.
--
-- The split-off order has no table: V63's uk_rest_order_open_table allows one
-- OPEN order per table, and the split is OPEN for the instant between being
-- built and being settled. It keeps its order_type (DINE_IN) and gets its own
-- order number, and split_from_id is how "Order 15" is traced back to the tab
-- it was paid out of.
--
-- Fired quantities travel with the lines they belong to, so the kitchen is
-- never asked to cook a split-off dish again.

ALTER TABLE restaurant_orders ADD COLUMN split_from_id UUID REFERENCES restaurant_orders(id);
