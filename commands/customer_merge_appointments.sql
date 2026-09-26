UPDATE appointments_appointment
   SET customer_id = :surviving_id,
       updated_by  = :current_user_id,
       updated_at  = :now
 WHERE hub_id = :hub_id
   AND customer_id = :absorbed_id
   AND CAST(:surviving_id AS TEXT) <> CAST(:absorbed_id AS TEXT);

-- Appointments · `customer.merged` — re-point a merged customer's appointments and recurring series
-- to the survivor (customers#86/customers#87).
--
-- Two files, one per table, because Postgres runs each `sql[]` file as ONE prepared statement; the
-- command's transaction keeps them atomic. This file moves the appointments; the series move in
-- `customer_merge_recurring.sql`.
--
-- Runs from the outbox relay: the payload IS the emitter's params (`surviving_id`, `absorbed_id`,
-- `hub_id`), so there is no `schema` on the command.
--
-- The `hub_id` guard is load-bearing: `customer_id` is an opaque id with no cross-module foreign
-- key, and the same string may name a different person in another hub.
--
-- ALL rows move — live and soft-deleted appointments of any status, and active, paused or deleted
-- series — because this is the customer's history, and a series left on the absorbed id would keep
-- materialising visits for a retired sheet. Nothing else on the row (number, denormalised names,
-- service, staff, times, status, notes) is touched: the names are a snapshot of the booking.
--
-- No unique index in this module includes `customer_id`, so this blind re-point cannot collide.
-- It never reads `customers`, so it does not require the absorbed sheet to still exist.
--
-- The surviving<>absorbed guard turns a degenerate event into a no-op instead of re-stamping rows
-- that are already correct.
--
-- IDEMPOTENT: the outbox is at-least-once, so a redelivery matches zero rows. No `expect_rows`:
-- merging a customer who never booked is the ordinary case.
