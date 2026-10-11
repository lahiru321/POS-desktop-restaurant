-- Voids: one row each time food comes off a tab.
--
-- With one till on the cashier desk, a void is the easiest way for money to
-- go missing: ring a dish, take cash, void the dish. The owner needs to see
-- every void — what, how much, whether the kitchen had already cooked it, who
-- did it and who approved it. restaurant_order_items only keeps a running
-- voided_quantity, and the audit log holds the rest as free-form JSON, so the
-- report gets its own append-only table, written by RestaurantOrderService in
-- the same transaction as the void itself.
--
-- amount is the menu value of what came off (price + add-ons, before any line
-- discount), priced at the time of the void. fired_quantity is how much of it
-- the kitchen had already been told to cook — the part that cost real food.
--
-- Backfill: voids made before this table existed are rebuilt from the items,
-- one row per item. Who did them is not known for certain; updated_by on the
-- item is the last person to touch it, which for a voided line is normally the
-- voider. Whole-tab voids are recognised by the tab's VOIDED status.

CREATE TABLE restaurant_voids (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    order_id UUID NOT NULL REFERENCES restaurant_orders(id),
    order_item_id UUID NOT NULL,  -- no FK: history outlives the line (a split may delete an unvoided one)
    item_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(19,3) NOT NULL,
    fired_quantity NUMERIC(19,3) NOT NULL DEFAULT 0,
    amount NUMERIC(12,2) NOT NULL,
    whole_tab BOOLEAN NOT NULL DEFAULT FALSE,
    reason VARCHAR(255),
    voided_by UUID,
    approved_by UUID,
    voided_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_rv_tenant_voided_at ON restaurant_voids(tenant_id, voided_at);

INSERT INTO restaurant_voids (id, tenant_id, branch_id, order_id, order_item_id, item_name,
        quantity, fired_quantity, amount, whole_tab, reason, voided_by, approved_by,
        voided_at, created_at, created_by, version)
SELECT uuid_generate_v4(), i.tenant_id, o.branch_id, o.id, i.id, i.item_name,
       i.voided_quantity, 0,
       ROUND((i.unit_price_snapshot + COALESCE((
            SELECT SUM(t.unit_price * t.quantity)
            FROM restaurant_order_item_toppings t
            WHERE t.order_item_id = i.id), 0)) * i.voided_quantity, 2),
       o.status = 'VOIDED', NULL, i.updated_by, NULL,
       COALESCE(i.updated_at, i.created_at), COALESCE(i.updated_at, i.created_at), i.updated_by, 0
FROM restaurant_order_items i
JOIN restaurant_orders o ON o.id = i.order_id
WHERE i.voided_quantity > 0;
