-- Course-by-course firing: the kitchen gets each course when the table is ready
-- for it, not all at once.
--
-- A table orders soup and kottu together. The server rings both in straight
-- away, marking the kottu course 2, and presses Send: only the soup prints. The
-- kottu waits on the tab, visibly "held", until the server presses "Fire course
-- 2" as the soup bowls come back — and only then does the kitchen see it. Nothing
-- is cooked early and left to go cold at the pass.
--
-- released_course is how far the kitchen has been told to go. Send fires every
-- unsent line whose course_no is at or below it; "Fire course N" raises it to N
-- and fires. It only ever rises, so an extra starter or main ordered after the
-- mains were fired still goes on the next Send, while dessert keeps waiting.
--
-- Every tab starts at 1, and every line already on disk is course 1, so an
-- existing open tab behaves exactly as before: Send sends everything. Takeaway
-- never holds anything — it fires on payment with every course released.

ALTER TABLE restaurant_orders ADD COLUMN released_course INT NOT NULL DEFAULT 1;

ALTER TABLE restaurant_orders
    ADD CONSTRAINT chk_rest_order_released_course CHECK (released_course >= 1);
