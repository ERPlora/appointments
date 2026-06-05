-- Alta de plantilla de cita recurrente (Tier 0). La materialización de las ocurrencias
-- (generar las citas reales según frequency/start_date/end_date/max_occurrences) NO se hace
-- aquí: es el motor de recurrencia → ver WASM-TODO. Runtime inyecta :new_id/:hub_id/:current_user_id/:now.
INSERT INTO appointments_recurring
  (id, hub_id, customer_id, customer_name, service_id, service_name, staff_id, staff_name,
   frequency, day_of_week, time, duration_minutes, start_date, end_date, max_occurrences, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :customer_id, :customer_name, :service_id, :service_name, :staff_id, :staff_name,
   :frequency, :day_of_week, :time, :duration_minutes, :start_date, :end_date, :max_occurrences, 1,
   0, :current_user_id, :current_user_id, :now, :now);
