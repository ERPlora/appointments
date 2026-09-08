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
-- The ids travel with the row (appointments#21): `staff_id` is what groups the view by
-- professional (one timeline row per professional), and `customer_id`/`service_id`/
-- `service_price` are what chain the appointment to the sale without retyping. Without them the
-- view knew WHO was attending only by a denormalized name, impossible to group reliably.
--
-- NO `customer_phone` / `customer_email` here (appointments#146). This query carries an `ai`
-- block, so it is offered as a TOOL to the assistant and to the `ai` step of any flow granted it
-- — including the unattended WhatsApp recipe, where a stranger's message decides the arguments.
-- It asks for a whole DAY, and a read cannot be narrowed to «the person writing» (a `query` grant
-- pins only the name, ERPlora/hub#1662), so one prompt would have returned the day's contact
-- sheet. `customer_name` stays: it is identity, not a channel, and the agenda column, the
-- calendar title, the search keys and the assistant's «who have I got at ten?» all need it.
-- The counter reads the full row —phone and email included— through `appointments.appointments.get`,
-- which has no `ai` block. Pinned by `tests/model_readable_columns.contract.test.py`.
SELECT id, appointment_number, customer_id, customer_name,
       service_id, service_name, service_price, staff_id, staff_name,
       start_datetime, end_datetime,
       -- `converted_sale_id` (sales#89): la venta que nació de esta cita. Lo escribe el listener
       -- `_mark_converted` desde el día que existe la columna, pero NINGUNA query lo devolvía, así
       -- que la agenda no podía contestar «¿esta cita ya se cobró?» ni impedir cobrarla dos veces.
       duration_minutes, status, converted_sale_id
FROM appointments_appointment
WHERE hub_id = :hub_id AND is_deleted = 0
  AND start_datetime >= :day_start
  AND start_datetime <  :day_end
  AND (COALESCE(CAST(:status   AS text), '') = '' OR status   = :status)
  AND (COALESCE(CAST(:staff_id AS text), '') = '' OR staff_id = :staff_id)
ORDER BY start_datetime ASC
LIMIT :limit;
