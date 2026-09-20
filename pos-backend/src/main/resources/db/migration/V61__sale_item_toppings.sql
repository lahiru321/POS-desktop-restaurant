-- Parent/child structure on sale lines, so a topping is its own priced, taxed,
-- returnable row hanging off the dish it modifies.
--
-- sale_items has been flat since V9. Folding a topping's price into the parent's
-- unit price would hide it from the receipt, from the VAT breakdown and from
-- returns — a customer could not be refunded the burger but not the extra
-- cheese — and it would make a manually-typed topping price unauditable.
--
-- A topping row deliberately carries product_id = NULL, with its name in
-- item_name and its definition in topping_id. That is the same shape V49 gave
-- custom/open lines, and it means every product-level report query — all of
-- which already filter "si.product_id IS NOT NULL" — excludes toppings for
-- free. No reporting query changes. The trade is that topping revenue does not
-- appear in product profitability; a dedicated topping report is the answer,
-- not weakening that filter.
--
-- topping_id is what tells a topping row apart from a V49 custom line, since
-- both have a null product_id.
--
-- The self-FK is DEFERRABLE INITIALLY DEFERRED on purpose. Parent and child are
-- both elements of the same cascaded SaleEntity.items collection, and Hibernate
-- makes no guarantee about insert ordering *within* one entity type — a child
-- can be written before its parent. Deferring the check to COMMIT removes that
-- hazard entirely rather than relying on flush order we do not control.
--
-- sort_order preserves the cashier's line order: the existing @OneToMany has no
-- @OrderBy, and Postgres guarantees no ordering without one. A receipt whose
-- toppings drift away from their dish is unreadable.

ALTER TABLE sale_items ADD COLUMN parent_item_id UUID;
ALTER TABLE sale_items ADD CONSTRAINT fk_sale_items_parent
    FOREIGN KEY (parent_item_id) REFERENCES sale_items(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE sale_items ADD COLUMN topping_id UUID REFERENCES toppings(id);

ALTER TABLE sale_items ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

-- Kitchen/counter free text carried onto the bill: "no chilli", "well done".
ALTER TABLE sale_items ADD COLUMN notes VARCHAR(255);

CREATE INDEX idx_sale_items_parent ON sale_items(parent_item_id);

COMMENT ON COLUMN sale_items.parent_item_id IS
    'Dish this add-on line modifies; NULL for a top-level line.';
COMMENT ON COLUMN sale_items.topping_id IS
    'Topping definition this line came from; distinguishes a topping row from a V49 custom line (both have a null product_id).';
