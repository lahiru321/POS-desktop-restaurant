-- Kitchen tickets: what the kitchen was told to cook, and whether it heard.
--
-- A ticket is written PENDING by the server BEFORE the till prints it, then
-- moved to PRINTED or FAILED by an explicit acknowledgement from that till.
-- The order is: persist, then print, then ack. A ticket left PENDING (browser
-- closed, machine died mid-print) is indistinguishable from a failed print and
-- is treated as one — the till's red badge counts both. A kitchen that never
-- got the order while the cashier saw success is the failure this table exists
-- to make impossible.
--
-- Ticket lines are a SNAPSHOT, not a join. The order moves on after a fire —
-- lines are voided, quantities grow, dishes are renamed — and a reprint must
-- reproduce exactly the paper the kitchen was handed, not today's view of the
-- tab. That is why the header (table, covers, server) is copied here too.
--
-- round_no labels the paper: "#0042-R2", "#0042-R3-VOID". Every ticket takes
-- the next round, a void ticket included, so the kitchen sees one unbroken
-- series per order and no two sheets ever carry the same label. restaurant_
-- orders.round_count is the allocator; the unique index below is what turns a
-- bug in it into a failure rather than two indistinguishable sheets.
--
-- station is the multi-printer seam. v1 prints every station to the one
-- kitchen printer; a bar printer later is a config entry and a loop, with no
-- schema change and no re-fire logic. It is resolved at fire time from
-- products.kitchen_station, then categories.kitchen_station, then 'KITCHEN'.

CREATE TABLE kitchen_tickets (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    -- No cascade: an order is never deleted, and if one ever were, the record of
    -- what the kitchen was told should not silently go with it.
    order_id UUID NOT NULL REFERENCES restaurant_orders(id),
    -- ROUND (new items to cook) or VOID (stop cooking these).
    ticket_type VARCHAR(20) NOT NULL,
    round_no INT NOT NULL,
    -- "#0042-R2" / "#0042-R3-VOID". Stored, not derived, so it is searchable and
    -- a reprint prints the label that was on the original sheet.
    label VARCHAR(40) NOT NULL,
    -- KITCHEN today. See the header.
    station VARCHAR(20) NOT NULL DEFAULT 'KITCHEN',
    -- PENDING, PRINTED, FAILED.
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    -- Header snapshot, as printed.
    order_number INT NOT NULL,
    -- DINE_IN, TAKEAWAY.
    order_type VARCHAR(20) NOT NULL,
    table_name VARCHAR(50),
    covers INT NOT NULL DEFAULT 0,
    server_name VARCHAR(100),
    -- Every acknowledgement, success or failure, counts as one attempt.
    print_attempts INT NOT NULL DEFAULT 0,
    -- The last printer error, or the note left when someone marked a failed
    -- ticket handled by hand ("told the kitchen verbally").
    last_error VARCHAR(500),
    printed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

-- One sheet per (order, round, station). Two sheets with the same label would
-- leave the kitchen unable to tell a duplicate from a second order.
CREATE UNIQUE INDEX uk_kt_order_round_station ON kitchen_tickets(order_id, round_no, station);

-- The till's badge poll: this tenant's unresolved tickets, oldest first.
CREATE INDEX idx_kt_tenant_status ON kitchen_tickets(tenant_id, status, created_at);

CREATE INDEX idx_kt_tenant_order ON kitchen_tickets(tenant_id, order_id, round_no);

CREATE TABLE kitchen_ticket_items (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    ticket_id UUID NOT NULL REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
    -- SET NULL, not CASCADE: deleting an order line must not erase the record of
    -- what the kitchen was already told to cook.
    order_item_id UUID REFERENCES restaurant_order_items(id) ON DELETE SET NULL,
    item_name VARCHAR(255) NOT NULL,
    -- How many to cook (ROUND) or to stop cooking (VOID) on this sheet — the
    -- delta, never the line's running total.
    quantity NUMERIC(19, 3) NOT NULL,
    -- Add-ons flattened to one per line ("Extra cheese", "2 x Egg"), as printed.
    modifiers VARCHAR(1000),
    notes VARCHAR(255),
    course_no INT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_kt_item_quantity CHECK (quantity > 0)
);

CREATE INDEX idx_kt_item_ticket ON kitchen_ticket_items(ticket_id, course_no, sort_order);
CREATE INDEX idx_kt_item_tenant ON kitchen_ticket_items(tenant_id);

-- Which printer a dish goes to. NULL = inherit: product, then its category,
-- then 'KITCHEN'. Nullable on purpose, so "not set" is distinguishable from an
-- explicit choice when a bar printer arrives.
ALTER TABLE products ADD COLUMN kitchen_station VARCHAR(20);
ALTER TABLE categories ADD COLUMN kitchen_station VARCHAR(20);
