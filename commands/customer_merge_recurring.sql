UPDATE appointments_recurring
   SET customer_id = :surviving_id,
       updated_by  = :current_user_id,
       updated_at  = :now
 WHERE hub_id = :hub_id
   AND customer_id = :absorbed_id
   AND CAST(:surviving_id AS TEXT) <> CAST(:absorbed_id AS TEXT);

-- Appointments · `customer.merged`, second half: re-point the recurring series of the absorbed
-- customer to the survivor, so the series keeps materialising visits for the sheet that remains.
-- Same contract as `customer_merge_appointments.sql` (hub guard, surviving<>absorbed guard,
-- idempotent, every row whatever its state); split off because a `sql[]` file is one statement.
