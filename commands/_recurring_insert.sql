-- Template INSERT of a recurring appointment, invoked by the WASM handler `create_recurring`
-- (`appointments.recurring.create`) AFTER it has resolved the customer, the service and the
-- professional against the catalogue — including that the professional performs the service
-- (appointments#283). Internal: no caller reaches it directly, so no series is written without
-- that check. The occurrences are booked by `recurring.materialize`, not here.
-- `:recurring_id` is the id the host minted in `context.new_ids` and the handler hands over, so
-- the row is the one the answer names in `new_ids[0]`. Runtime injects :hub_id/:current_user_id/:now.
INSERT INTO appointments_recurring
  (id, hub_id, customer_id, customer_name, service_id, service_name, staff_id, staff_name,
   frequency, day_of_week, time, duration_minutes, start_date, end_date, max_occurrences, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:recurring_id, :hub_id, :customer_id, :customer_name, :service_id, :service_name, :staff_id, :staff_name,
   :frequency, :day_of_week, :time, :duration_minutes, :start_date, :end_date, :max_occurrences, 1,
   0, :current_user_id, :current_user_id, :now, :now);
