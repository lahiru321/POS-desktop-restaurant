-- Purchase-order lines can buy an ingredient instead of a product.
--
-- A restaurant's supplier delivers 25 kg of rice and 24 bottles of water on one
-- invoice. The rice is an ingredient (V72); the water is a stock-tracked menu
-- item. A line is now exactly one of the two, enforced here rather than trusted
-- to the service.
--
-- Quantities widen from INT to NUMERIC(12,3) so 2.5 kg can be ordered and
-- received. Every existing integer is a valid NUMERIC, so this is a pure
-- widening; product lines are still held to whole numbers by the service,
-- because product stock (stock_levels.quantity) is an INT.
--
-- unit_cost widens to four places for the same reason as
-- ingredients.cost_per_unit: a per-gram or per-millilitre price. total_cost
-- stays at two — it is money actually owed.

ALTER TABLE purchase_order_items ADD COLUMN ingredient_id UUID REFERENCES ingredients(id);
ALTER TABLE purchase_order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE purchase_order_items
    ADD CONSTRAINT chk_poi_product_or_ingredient CHECK (num_nonnulls(product_id, ingredient_id) = 1);

ALTER TABLE purchase_order_items ALTER COLUMN ordered_quantity TYPE NUMERIC(12, 3);
ALTER TABLE purchase_order_items ALTER COLUMN received_quantity TYPE NUMERIC(12, 3);
ALTER TABLE purchase_order_items ALTER COLUMN unit_cost TYPE NUMERIC(15, 4);

CREATE INDEX idx_poi_ingredient ON purchase_order_items(ingredient_id);
