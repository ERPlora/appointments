-- Inserción de cita de bajo nivel (Tier 0) invocada por el handler WASM (create_appointment /
-- bulk_create / materialize_recurring) DESPUÉS de validar solape. NO se llama directa desde la
-- UI (es interno). El WASM nunca toca la BD: devuelve la intención y el runtime ejecuta esta
-- sentencia con los binds resueltos. Runtime inyecta :hub_id/:current_user_id/:now.
-- :appointment_id viene de context.new_ids (el host es la autoridad de ids; el guest lo reparte
-- para correlacionar cita↔historial). El nº APT-YYYYMMDD-NNNN se calcula leyendo el contador
-- (recién incrementado por `_bump_counter`) en la MISMA transacción, sin read-back en el guest.
-- printf() es de SQLite; Postgres usaría lpad() (portabilidad SQL §14).
INSERT INTO appointments_appointment
  (id, hub_id, appointment_number, customer_id, customer_name, customer_phone, customer_email,
   staff_id, staff_name, service_id, service_name, service_price,
   start_datetime, end_datetime, duration_minutes, status, notes, internal_notes,
   booked_online, is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:appointment_id, :hub_id,
   'APT-' || :day || '-' || printf('%04d', (
       SELECT last_number FROM appointments_appointment_counter
       WHERE hub_id = :hub_id AND day = :day
   )),
   :customer_id, :customer_name, :customer_phone, :customer_email,
   :staff_id, :staff_name, :service_id, :service_name, :service_price,
   :start_datetime, :end_datetime, :duration_minutes, :status, :notes, :internal_notes,
   :booked_online, 0, :current_user_id, :current_user_id, :now, :now);
