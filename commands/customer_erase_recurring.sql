UPDATE appointments_recurring
   SET customer_name = '',
       updated_by    = :current_user_id,
       updated_at    = :now
 WHERE hub_id = :hub_id
   AND customer_id = :customer_id
   AND CAST(:customer_id AS TEXT) <> ''
   AND customer_name <> '';

-- Appointments · `customer.anonymized`, step 2/3 — the recurring series forget the customer's name
-- (pm#637, APPOINTMENTS-F24). Same contract as `customer_erase_appointments.sql` (hub guard,
-- empty-id guard, idempotent, every series whatever its state); split off because a `sql[]` file
-- is one statement.
--
-- The name is the only thing a series copies from the sheet. `is_active` is KEPT: a series cannot
-- book more dates for an erased customer anyway — `recurring.materialize` resolves the customer
-- through `customers.get`, which no longer returns an erased sheet, and refuses — and pausing it
-- here would rewrite the salon's own setting behind its back.
