-- Where each table stands on its area's floor map.
--
-- Until now the floor was a tile grid in sort_order, reflowed to the screen
-- width, so "T7" could be anywhere depending on the till. A server finds a table
-- by where it is in the room, so an area can now be laid out as a map: each table
-- sits on one cell of a grid (pos_x = column, pos_y = row, both from 0), and the
-- till draws the map, not a list.
--
-- NULL/NULL means "not placed yet". Every existing table starts that way, and
-- the till keeps showing unplaced tables as ordinary tiles, so this changes
-- nothing on a floor nobody has arranged.
--
-- The grid is capped at 16 x 16 — far more than a room needs, and a cap keeps a
-- mis-drop from producing a map that is one table and ninety empty columns.
--
-- Two tables on one cell is refused. The unique constraint is DEFERRABLE
-- INITIALLY DEFERRED on purpose: a layout is saved in one transaction, and
-- swapping T1 and T4 means one of them passes through the other's cell before
-- the commit. Hibernate orders those UPDATEs as it likes, so an immediate check
-- would fail a perfectly valid swap (the same reason V61's self-FK is deferred).
-- NULLs never collide, so any number of tables can be unplaced.

ALTER TABLE restaurant_tables
    ADD COLUMN pos_x INT,
    ADD COLUMN pos_y INT;

ALTER TABLE restaurant_tables
    ADD CONSTRAINT chk_rest_table_pos_pair CHECK ((pos_x IS NULL) = (pos_y IS NULL));

ALTER TABLE restaurant_tables
    ADD CONSTRAINT chk_rest_table_pos_range
        CHECK (pos_x IS NULL OR (pos_x BETWEEN 0 AND 15 AND pos_y BETWEEN 0 AND 15));

ALTER TABLE restaurant_tables
    ADD CONSTRAINT uk_rest_table_area_pos UNIQUE (area_id, pos_x, pos_y)
        DEFERRABLE INITIALLY DEFERRED;
