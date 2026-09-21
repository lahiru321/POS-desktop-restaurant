-- The floor: areas and the tables that sit in them, plus the RESTAURANT feature
-- grant for installs provisioned by an earlier build.
--
-- An area is a named part of the room ("Ground Floor", "Balcony", "Garden") and
-- exists mainly so the floor view can tab between sections instead of showing
-- forty tiles at once. A table belongs to exactly one area.
--
-- Areas and tables are tenant-scoped, not branch-scoped: this product is one
-- restaurant per install. Orders still carry a branch (they settle through a
-- cash drawer, which is per branch), but a floor plan that spans branches is a
-- multi-location concern nothing here has. Add branch_id when that day comes.
--
-- restaurant_tables.status is a DENORMALISED read for the floor grid, not the
-- source of truth. The real invariant — one table, at most one open tab — is
-- the partial unique index on restaurant_orders(table_id) WHERE status = 'OPEN'
-- that arrives with V63. Status exists so painting fifty tiles is one query
-- instead of fifty; a repair that recomputes it from open orders is always
-- safe.

CREATE TABLE restaurant_areas (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    -- Soft delete: an area with history must stay resolvable, so the UI hides
    -- rather than deletes once tables have been seated in it.
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE restaurant_tables (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    area_id UUID NOT NULL REFERENCES restaurant_areas(id),
    -- What the staff call it: "T1", "12", "Window 3". Short on purpose — it is
    -- printed on kitchen tickets and read across a room.
    name VARCHAR(50) NOT NULL,
    -- Covers the table normally seats. A hint for the floor view and the
    -- default covers on a new tab, never a limit that blocks seating.
    seats INT NOT NULL DEFAULT 2,
    -- AVAILABLE, OCCUPIED. See the header: derived state, kept for cheap reads.
    status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_rest_area_tenant ON restaurant_areas(tenant_id, sort_order);
CREATE INDEX idx_rest_table_tenant_area ON restaurant_tables(tenant_id, area_id, sort_order);

-- Two tables called "4" in the same area is a mis-click, not a floor plan: the
-- server would take an order for one and the kitchen would carry it to the
-- other. Scoped to the area, so "1" on the Balcony and "1" in the Garden are
-- both fine.
CREATE UNIQUE INDEX uk_rest_table_area_name ON restaurant_tables(area_id, name);

-- Desktop installs are provisioned once with the full feature set (see
-- SuperAdminTenantService.provisionFromSeed), which now includes RESTAURANT.
-- Backfill it onto any tenant already provisioned by an earlier build so the
-- feature is available without a super-admin trip to toggle it on.
--
-- This grant only means "the /api/v1/restaurant routes are reachable". Whether
-- this business actually IS a restaurant is the separate restaurantMode flag in
-- tenants.settings, which stays off until the owner turns it on — so a retail
-- till that takes this update sees no change at all.
UPDATE tenant_configurations
SET features_enabled = features_enabled || '["RESTAURANT"]'::jsonb
WHERE NOT (features_enabled @> '["RESTAURANT"]'::jsonb);
