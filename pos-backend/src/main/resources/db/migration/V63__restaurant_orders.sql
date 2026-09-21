-- The open tab: an order aggregate of its own, deliberately NOT a DRAFT sale.
--
-- SaleService.createSale stamps cash_session_id from the CREATING user's open
-- drawer. A tab opened by one server at 7pm and paid at the counter by another
-- at 9pm would therefore land on the wrong drawer and corrupt the Z-report. So
-- an order accumulates here, and settling calls createSale UNMODIFIED at the
-- moment of payment — the sale lands on the PAYING cashier, which is the only
-- answer that keeps drawer reconciliation honest.
--
-- Nothing in this migration touches sales or sale_items. The money path is
-- reached only at settle, through the same public method the retail terminal
-- uses, with no restaurant-shaped parameters added to it.
--
-- business_date is the store's calendar day in Asia/Colombo (the STORE_ZONE
-- constant SaleService already uses), not the server's UTC date — which would
-- roll the order numbers over at 05:30 local, in the middle of a late shift.
--
-- unit_price_snapshot records what the dish cost when it was ordered. It is
-- NOT what gets billed: createSale re-reads products.base_price at settle and
-- ignores any client figure, so a menu price changed mid-meal re-prices the
-- tab. That is correct server-authoritative behaviour; the snapshot exists so
-- the settle response can TELL the cashier which lines moved, rather than
-- silently charging a different number from the one quoted.
--
-- fired_quantity and voided_quantity are the firing mechanism. Unfired work is
-- quantity - fired_quantity, so a second round prints only what the kitchen has
-- not already been told to cook. Voids are counted separately rather than
-- subtracted from quantity, because an item can be voided AFTER it was fired —
-- the kitchen still needs a void ticket, and the bill still needs the line gone.

CREATE TABLE restaurant_orders (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    branch_id UUID NOT NULL REFERENCES branches(id),
    -- Per (tenant, branch, business_date), allocated by restaurant_order_counters.
    -- What staff shout across the room: "order 14", not a UUID.
    order_number INT NOT NULL,
    -- Store calendar day in Asia/Colombo. See the header.
    business_date DATE NOT NULL,
    -- DINE_IN, TAKEAWAY.
    order_type VARCHAR(20) NOT NULL DEFAULT 'DINE_IN',
    -- NULL for takeaway. No cascade: deleting a table must not delete its history.
    table_id UUID REFERENCES restaurant_tables(id),
    -- No FK, matching sales.customer_id.
    customer_id UUID,
    -- OPEN, SETTLED, VOIDED.
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    -- Guests at the table. 0 = not recorded; never a limit on seating.
    covers INT NOT NULL DEFAULT 0,
    -- Who opened the tab and who is looking after it. Deliberately separate:
    -- the settling cashier is neither, and is recorded on the sale instead.
    opened_by UUID,
    served_by UUID,
    -- Set at settle. The link from a tab to the money it became.
    sale_id UUID REFERENCES sales(id),
    -- How many times this order has been fired to the kitchen. Labels rounds
    -- ("order 14 · round 3") without counting tickets at read time.
    round_count INT NOT NULL DEFAULT 0,
    opened_at TIMESTAMP NOT NULL,
    settled_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

-- One table, at most one open tab. Enforced by the database, not by hope: two
-- servers seating the same table at the same moment is a race no amount of
-- application checking closes. Partial, so settled and voided orders pile up on
-- a table freely, and takeaway orders (table_id NULL) are unaffected.
CREATE UNIQUE INDEX uk_rest_order_open_table
    ON restaurant_orders(table_id)
    WHERE status = 'OPEN' AND table_id IS NOT NULL;

-- Two tabs called "order 14" on one day in one branch is worse than useless —
-- the kitchen cannot tell them apart. The counter allocates atomically; this
-- index is what makes a bug in that allocation a failure rather than a silent
-- duplicate.
CREATE UNIQUE INDEX uk_rest_order_number
    ON restaurant_orders(tenant_id, branch_id, business_date, order_number);

-- The floor view's poll: every open tab for this tenant, newest first.
CREATE INDEX idx_rest_order_tenant_status
    ON restaurant_orders(tenant_id, status, opened_at DESC);

CREATE TABLE restaurant_order_items (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL REFERENCES restaurant_orders(id) ON DELETE CASCADE,
    -- NULL for a custom/open line, exactly as sale_items has allowed since V49.
    product_id UUID REFERENCES products(id),
    -- Snapshot, so a renamed or deleted product still reads correctly on an
    -- open tab and on the kitchen ticket already carried to the pass.
    item_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(19, 3) NOT NULL,
    -- Already sent to the kitchen. quantity - fired_quantity is the next round.
    fired_quantity NUMERIC(19, 3) NOT NULL DEFAULT 0,
    -- Cancelled. Counted separately because a void can follow a fire.
    voided_quantity NUMERIC(19, 3) NOT NULL DEFAULT 0,
    -- What it cost when ordered. Not what is billed — see the header.
    unit_price_snapshot NUMERIC(12, 2) NOT NULL,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    -- "no chilli", "well done" — carried to the kitchen and onto the bill.
    notes VARCHAR(255),
    -- Starters 1, mains 2, dessert 3. Course-by-course firing is Phase 5; the
    -- column lands now so orders taken before then are not stuck at one course.
    course_no INT NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_rest_oitem_quantity CHECK (quantity > 0),
    -- Neither counter may exceed what was ordered. They are bounded separately,
    -- not summed: voiding a fired item legitimately counts in both.
    CONSTRAINT ck_rest_oitem_fired CHECK (fired_quantity >= 0 AND fired_quantity <= quantity),
    CONSTRAINT ck_rest_oitem_voided CHECK (voided_quantity >= 0 AND voided_quantity <= quantity)
);

CREATE INDEX idx_rest_oitem_order ON restaurant_order_items(order_id, course_no, sort_order);
CREATE INDEX idx_rest_oitem_tenant ON restaurant_order_items(tenant_id);

-- An order line's add-ons, while the tab is open. These become child sale_items
-- rows (parent_item_id, V61) at settle — they are not the same rows, because a
-- tab is not a sale until it is paid for.
CREATE TABLE restaurant_order_item_toppings (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    order_item_id UUID NOT NULL REFERENCES restaurant_order_items(id) ON DELETE CASCADE,
    -- SET NULL, not CASCADE: deleting a topping from the menu must not silently
    -- remove it from a tab a customer is already eating.
    topping_id UUID REFERENCES toppings(id) ON DELETE SET NULL,
    -- Snapshot, so renaming "Extra cheese" never rewrites an open tab.
    topping_name VARCHAR(100) NOT NULL,
    quantity NUMERIC(19, 3) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    -- FIXED or PROMPT, copied from the topping at order time. Kept on the row
    -- so settle can re-derive the price the same way ring-up did: FIXED re-reads
    -- the definition, PROMPT honours the typed figure. A client cannot set it.
    price_mode VARCHAR(20) NOT NULL DEFAULT 'FIXED',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_rest_oitop_item ON restaurant_order_item_toppings(order_item_id, sort_order);
CREATE INDEX idx_rest_oitop_tenant ON restaurant_order_item_toppings(tenant_id);

-- Order-number allocation, one row per (tenant, branch, business_date).
--
-- Deliberately NOT house style: no id, no audit block. The composite key IS the
-- row's identity, and it exists so a single atomic statement can allocate:
--
--   INSERT INTO restaurant_order_counters (tenant_id, branch_id, business_date, last_number)
--   VALUES (?, ?, ?, 1)
--   ON CONFLICT (tenant_id, branch_id, business_date)
--   DO UPDATE SET last_number = restaurant_order_counters.last_number + 1
--   RETURNING last_number
--
-- Two servers opening tabs in the same second get 14 and 15 without either
-- blocking, and without a SELECT MAX(order_number) race that would hand both
-- the same number.
CREATE TABLE restaurant_order_counters (
    tenant_id UUID NOT NULL,
    branch_id UUID NOT NULL,
    business_date DATE NOT NULL,
    last_number INT NOT NULL,
    PRIMARY KEY (tenant_id, branch_id, business_date)
);
