-- Toppings / add-ons, modelled as per-item groups a product opts into.
--
-- A group is a question the cashier is asked ("Cheese?", "Extras", "Sauce"); a
-- topping is an answer that carries a price. A product declares which groups
-- apply to it, so a pizza offers pizza toppings and a burger offers burger
-- add-ons without either list having to be re-authored per dish.
--
-- price_mode is the point of the whole design:
--
--   FIXED  - always billed at default_price. The price in the request is
--            IGNORED, exactly as it is for a catalogue product
--            (SaleService forces unitPrice = product.basePrice).
--
--   PROMPT - the owner has explicitly declared "the cashier types this price at
--            order time". The typed figure is accepted, clamped to max_price.
--
-- That is the only hole opened in server-authoritative pricing, and it is
-- narrow on purpose: it is opt-in per topping, the flag lives on a server-side
-- row that no client can set, it is bounded by max_price, and it is enforced in
-- exactly one place. Custom/open lines (product_id NULL + item_name) already
-- accept a typed price because they have no catalogue entry to check against; a
-- topping DOES have one, so it must not reuse that path.

CREATE TABLE topping_groups (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    -- SINGLE = pick at most one (radio). MULTI = any number (checkbox).
    selection_mode VARCHAR(20) NOT NULL DEFAULT 'MULTI',
    -- Minimum answers before the line can be added. 0 = entirely optional.
    min_select INT NOT NULL DEFAULT 0,
    -- NULL = no ceiling.
    max_select INT,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_tgrp_tenant ON topping_groups(tenant_id, sort_order);

CREATE TABLE toppings (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    group_id UUID NOT NULL REFERENCES topping_groups(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    -- FIXED or PROMPT — see the header.
    price_mode VARCHAR(20) NOT NULL DEFAULT 'FIXED',
    default_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    -- PROMPT only: the ceiling a typed price is clamped to. NULL = uncapped.
    max_price NUMERIC(12, 2),
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_topping_tenant_group ON toppings(tenant_id, group_id, sort_order);

-- Which groups apply to which product. A join row rather than a column on
-- products, so one group is authored once and attached to many dishes.
CREATE TABLE product_topping_groups (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES topping_groups(id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX uk_ptg_product_group ON product_topping_groups(product_id, group_id);
CREATE INDEX idx_ptg_tenant_product ON product_topping_groups(tenant_id, product_id, sort_order);
