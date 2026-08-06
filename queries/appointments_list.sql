-- Lista de citas del hub para un día concreto (con filtros opcionales por estado/staff).
-- Runtime inyecta :hub_id. Portado de AppointmentService.list.
-- El filtro de día se aplica como rango [:day_start, :day_end) sobre start_datetime (ISO 8601).
-- Binds opcionales: :status/:staff_id ausentes o vacíos = todos. :limit acota el resultado.
-- Filtro NULL-safe portable (appointments#110): el runtime pasa NULL (no '') para los opcionales
-- omitidos. Sin más, `:p = ''` casa `NULL = ''` → NULL (no-true) y en SQLite lanza SQLITE_MISMATCH
-- (code 20); y en Postgres el bind NULL sin tipo (DynNull, OID 0) comparado contra el literal '' sin
-- tipo deja el parámetro `$n` sin tipo resoluble → 42P08 "could not determine data type of parameter".
-- `COALESCE(CAST(:p AS text), '')` fija el tipo del bind a TEXT en ambos dialectos y normaliza el
-- NULL a '' (mismo efecto que el `:p = ''` histórico, sin romper la resolución de tipos del driver).
-- Los IDs viajan con la fila (appointments#21): `staff_id` es lo que agrupa la vista por
-- profesional (una fila del timeline por profesional), y `customer_id`/`service_id`/
-- `service_price` son lo que encadena la cita con la venta sin re-teclear. Sin ellos la vista
-- sabía QUIÉN atendía solo por un nombre denormalizado, imposible de agrupar de forma fiable.
SELECT id, appointment_number, customer_id, customer_name, customer_phone, customer_email,
       service_id, service_name, service_price, staff_id, staff_name,
       start_datetime, end_datetime,
       duration_minutes, status
FROM appointments_appointment
WHERE hub_id = :hub_id AND is_deleted = 0
  AND start_datetime >= :day_start
  AND start_datetime <  :day_end
  AND (COALESCE(CAST(:status   AS text), '') = '' OR status   = :status)
  AND (COALESCE(CAST(:staff_id AS text), '') = '' OR staff_id = :staff_id)
ORDER BY start_datetime ASC
LIMIT :limit;
