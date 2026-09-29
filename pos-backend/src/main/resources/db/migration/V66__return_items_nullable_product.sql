-- A returned line need not be a product.
--
-- V16 made return_items.product_id NOT NULL, when every sale line was a
-- catalogue product. Since then two kinds of sale line carry no product: a
-- custom/open line (V49) and an add-on (V61, a child row with topping_id).
-- Both are money the customer paid, and both must be refundable — a burger
-- returned with its cheese has to give the cheese back too.
--
-- The service and its unit tests already handled a null product (no stock to
-- restore, the sale line's own name on the return), but this constraint made
-- the INSERT fail in a real database, so no add-on or custom line could ever
-- be refunded. Unit tests mock the repository and could not see it; the
-- restaurant e2e caught it.
--
-- The FK to products(id) stays: a non-null product_id must still be real.

ALTER TABLE return_items ALTER COLUMN product_id DROP NOT NULL;
