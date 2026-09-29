-- Moving and merging tabs, and telling the kitchen about it.
--
-- A tab can now change tables (T4 -> T7) or absorb another tab (the couple at T2
-- joins their friends at T7). Neither changes what is being cooked, but both
-- change where it has to be carried — and a runner holding a sheet that says T4
-- walks to an empty table. So when the kitchen already has food for the tab, the
-- move prints a MOVE ticket: no items, just the order, its new table and a one-
-- line notice ("MOVED FROM T4"). This column is that line.
--
-- New values, both in existing VARCHAR(20) columns with no CHECK constraint, so
-- no DDL is needed for them — recorded here because the column comments in V63
-- and V64 list the allowed values:
--   restaurant_orders.status     + MERGED  (its lines now live on another order)
--   kitchen_tickets.ticket_type  + MOVE    (no lines; carries a notice)
--
-- A merged order keeps its own kitchen tickets. They are the record of what was
-- sent under that order number, and a reprint must still say what it said.

ALTER TABLE kitchen_tickets ADD COLUMN notice VARCHAR(255);
