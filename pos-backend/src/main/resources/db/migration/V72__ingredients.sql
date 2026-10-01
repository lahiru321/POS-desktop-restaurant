-- Ingredients: what the kitchen buys, as opposed to what the menu sells.
--
-- A restaurant buys rice by the kilo, oil by the litre and eggs by the piece,
-- and sells none of them as such. Until now the only stock-carrying thing was a
-- product, so a purchase order could only buy something the till sells, and the
-- cost of food had nowhere to live. This adds three tables:
--   * ingredients — the catalogue (name, unit, last cost, low-stock alert).
--   * ingredient_stock_levels — quantity on hand per branch.
--   * ingredient_movements — an append-only ledger of every change to that
--     quantity, with the running balance captured per row, so a stock count or
--     a wastage entry can always be explained after the fact.
--
-- Quantities are NUMERIC(12,3): 2.5 kg, 0.750 L and 12 eggs all fit, and three
-- places is a gram of a kilo. cost_per_unit is NUMERIC(12,4) because the unit
-- can be small — a gram of saffron or a millilitre of essence costs fractions of
-- a cent, and two decimal places would round it to zero.
--
-- There are no recipes yet: selling a dish does not consume ingredients. Stock
-- goes up when a purchase order is received and down on wastage or a count.

CREATE TABLE ingredients (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    -- KG, G, L, ML, PCS
    unit VARCHAR(10) NOT NULL,
    -- The last price paid per unit; a received purchase order overwrites it.
    cost_per_unit NUMERIC(12, 4) NOT NULL DEFAULT 0,
    -- 0 = never alert.
    low_stock_threshold NUMERIC(12, 3) NOT NULL DEFAULT 0,
    primary_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

-- "Rice" and "rice" are the same sack.
CREATE UNIQUE INDEX uk_ingredients_tenant_name ON ingredients(tenant_id, lower(name));
CREATE INDEX idx_ing_tenant_active ON ingredients(tenant_id, is_active);

CREATE TABLE ingredient_stock_levels (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    ingredient_id UUID NOT NULL REFERENCES ingredients(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    quantity NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_ing_stock_ingredient_branch UNIQUE (ingredient_id, branch_id)
);

CREATE INDEX idx_ingsl_tenant_branch ON ingredient_stock_levels(tenant_id, branch_id);

CREATE TABLE ingredient_movements (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    ingredient_id UUID NOT NULL REFERENCES ingredients(id),
    branch_id UUID NOT NULL REFERENCES branches(id),
    -- PURCHASE (PO received), WASTAGE (spoiled/dropped), COUNT (stock take: the
    -- difference between what the system thought and what was counted), ADJUST
    -- (manual signed correction).
    movement_type VARCHAR(20) NOT NULL,
    -- Signed: positive adds stock, negative removes it.
    quantity_change NUMERIC(12, 3) NOT NULL,
    -- The branch's quantity after this movement was applied.
    quantity_after NUMERIC(12, 3) NOT NULL,
    -- Cost per unit at the time, so history values stock at what it cost then.
    unit_cost NUMERIC(12, 4),
    -- The purchase order for a PURCHASE; null otherwise.
    reference_id UUID,
    reason VARCHAR(255),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_ingm_tenant_ingredient_created ON ingredient_movements(tenant_id, ingredient_id, created_at DESC);
