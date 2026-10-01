-- Joined tables: one party, more than one table.
--
-- Eight people arrive, the waiter pushes T1 and T2 together, and it is one bill.
-- Until now the only tool was Merge, which folds a second TAB into the first and
-- frees its table — so T2 showed as available on the floor while people were
-- sitting at it, and the next server seated someone on top of them.
--
-- A tab keeps its own table in restaurant_orders.table_id (its "primary"), so
-- V63's uk_rest_order_open_table is untouched. Every further table it occupies
-- is a row here. Rows exist only while the tab is OPEN: settling, voiding or
-- merging the tab away deletes them, which is why table_id can be UNIQUE on its
-- own — a table belongs to at most one tab's join list, ever, at any moment.
--
-- Being some tab's primary AND another tab's joined table cannot be expressed
-- as a constraint across the two tables. The service locks the table row
-- (SELECT ... FOR UPDATE) before opening, joining or moving onto it, so those
-- three queue on the table and each sees the others' committed result.

CREATE TABLE restaurant_order_tables (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL REFERENCES restaurant_orders(id),
    table_id UUID NOT NULL REFERENCES restaurant_tables(id),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uk_rest_order_tables_table UNIQUE (table_id)
);

CREATE INDEX idx_rot_tenant_order ON restaurant_order_tables(tenant_id, order_id);
