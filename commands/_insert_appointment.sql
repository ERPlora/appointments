-- Inserción de cita de bajo nivel (Tier 0) invocada por el handler WASM `create_appointment`
-- DESPUÉS de validar solape y generar el appointment_number atómico. NO se llama directa
-- desde la UI (es interno). El WASM nunca toca la BD: devuelve la intención y el runtime
-- ejecuta esta sentencia con los binds resueltos. Runtime inyecta :hub_id/:current_user_id/:now.
INSERT INTO appointments_appointment
  (id, hub_id, appointment_number, customer_id, customer_name, customer_phone, customer_email,
   staff_id, staff_name, service_id, service_name, service_price,
   start_datetime, end_datetime, duration_minutes, status, notes, internal_notes,
   booked_online, is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :appointment_number, :customer_id, :customer_name, :customer_phone, :customer_email,
   :staff_id, :staff_name, :service_id, :service_name, :service_price,
   :start_datetime, :end_datetime, :duration_minutes, :status, :notes, :internal_notes,
   :booked_online, 0, :current_user_id, :current_user_id, :now, :now);
